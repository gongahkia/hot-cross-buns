package localruntime

import (
	"bytes"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/state"
)

// Serve is a private, per-profile controller. Its owner lease is process-held;
// another controller cannot adopt a listener or a process left by a crash.
func Serve(ctx context.Context, config Config) error {
	release, err := state.Guard(config.StateDir, false)
	if err != nil {
		return err
	}
	defer release()
	store, err := openStorage(config.StateDir)
	if err != nil {
		return err
	}
	defer store.close()
	binding, err := localmodel.ReadRuntimeBinding(config.StateDir)
	if err != nil {
		return err
	}
	if binding != nil && binding.ChildPID > 0 && processAlive(binding.ChildPID) {
		return errors.New("an owned process outlived its controller; inspect it before starting another")
	}
	address := "127.0.0.1:0"
	if binding != nil {
		u, _ := url.Parse(binding.Endpoint)
		address = u.Host
	} else {
		binding = &localmodel.RuntimeBinding{Version: 1, Profile: localmodel.RuntimeProfile(config.StateDir), Token: nonce()}
	}
	binding.Generation = nonce()
	binding.ChildPID = 0
	if binding.Generation == "" || binding.Token == "" {
		return errors.New("runtime identity unavailable")
	}
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		return errors.New("the reserved runtime address is unavailable; no listener was adopted")
	}
	defer listener.Close()
	binding.Endpoint = "https://" + listener.Addr().String()
	certificate, err := store.certificate(binding)
	if err != nil {
		return err
	}
	if config.ModelsDir == "" {
		config.ModelsDir, err = modelsDirectory(config.StateDir)
		if err != nil {
			return err
		}
	}
	if err = store.write("binding.json", binding); err != nil {
		return err
	}
	c := &controller{config: config, store: store, binding: binding, state: "stopped", last: time.Now()}
	var previous Receipt
	if err = store.read("operation.json", &previous); err == nil {
		c.receipt = &previous
		if previous.Phase == "prepared" || previous.Phase == "working" {
			if err := c.record("uncertain", "Controller restarted. No operation was replayed."); err != nil {
				return err
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 16 * 1024, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}}}
	done := make(chan struct{})
	defer close(done)
	c.shutdown = func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Host != listener.Addr().String() || r.Header.Get("Origin") != "" || subtle.ConstantTimeCompare([]byte(r.Header.Get(localmodel.RuntimeTokenHeader)), []byte(binding.Token)) != 1 {
			http.Error(w, "Private runtime transport", http.StatusForbidden)
			return
		}
		if r.URL.RawQuery != "" || r.URL.Fragment != "" {
			http.Error(w, "Invalid runtime path", http.StatusBadRequest)
			return
		}
		if r.URL.Path != "/__hcb/runtime" {
			c.proxy(w, r)
			return
		}
		if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "Use finite JSON actions", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var action Action
		if decoder.Decode(&action) != nil || decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "Invalid runtime action", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(c.action(action))
	})
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				c.shutdown()
				return
			case <-done:
				return
			case <-ticker.C:
				c.mu.Lock()
				if c.review != nil && time.Now().After(c.review.Expires) {
					c.review = nil
				}
				idle := c.child == nil && c.cancel == nil && c.state == "stopped" && c.review == nil && (time.Since(c.last) > 2*time.Minute || c.receipt != nil && c.receipt.Action == "runtime_stop" && c.receipt.Phase == "completed")
				if idle {
					c.closing = true
				}
				c.mu.Unlock()
				if idle {
					c.shutdown()
					return
				}
			}
		}
	}()
	err = server.Serve(tls.NewListener(listener, server.TLSConfig))
	c.mu.Lock()
	c.closing = true
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()
	c.workers.Wait()
	c.mu.Lock()
	owned := c.child
	active := c.active
	cancel := c.cancel
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if owned != nil && active == 0 {
		_ = terminate(owned)
		select {
		case <-owned.done:
		case <-time.After(3 * time.Second):
			_ = owned.command.Process.Kill()
			<-owned.done
		}
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Existing returns a read-only observation. It never launches a controller or
// Ollama; unconfirmed child metadata is kept as an explicit attention state.
func Existing(ctx context.Context, config Config) Result {
	binding, err := localmodel.ReadRuntimeBinding(config.StateDir)
	path, pathErr := binaryPath(config)
	status := Status{State: "stopped", Binary: path, Available: pathErr == nil}
	if err != nil {
		status.State = "uncertain"
		status.Issue = "Private runtime metadata is unavailable. Inspect it before starting another runtime."
		return Result{Status: status, Error: status.Issue}
	}
	if binding == nil {
		if pathErr != nil {
			status.Issue = pathErr.Error()
		}
		return Result{Status: status}
	}
	if result, err := request(ctx, *binding, Action{RequestID: nonce(), Action: "runtime_status"}); err == nil {
		return result
	}
	status.Endpoint = binding.Endpoint
	status.Generation = binding.Generation
	if binding.ChildPID > 0 && processAlive(binding.ChildPID) {
		status.State = "uncertain"
		status.Issue = "An owned runtime outlived its controller. No process will be adopted or stopped by PID."
	}
	directory := localmodel.RuntimeDirectory(config.StateDir)
	if file, err := os.OpenRoot(directory); err == nil {
		store := &storage{root: file}
		var receipt Receipt
		if store.read("operation.json", &receipt) == nil {
			if receipt.Phase == "prepared" || receipt.Phase == "working" {
				receipt.Phase = "uncertain"
				receipt.Issue = "The controller is unavailable. No operation was replayed."
			}
			status.Receipt = &receipt
		}
		file.Close()
	}
	return Result{Status: status}
}
func request(ctx context.Context, binding localmodel.RuntimeBinding, action Action) (Result, error) {
	client, err := localmodel.HTTPClient(binding.Endpoint)
	if err != nil {
		return Result{}, err
	}
	defer client.CloseIdleConnections()
	client.Timeout = 8 * time.Second
	body, err := json.Marshal(action)
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", binding.Endpoint+"/__hcb/runtime", bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return Result{}, errors.New("runtime controller refused the request")
	}
	var result Result
	decoder := json.NewDecoder(io.LimitReader(response.Body, 128*1024))
	if err = decoder.Decode(&result); err != nil {
		return Result{}, err
	}
	return result, nil
}

// Call starts only the private Go controller when a user requests a review. The
// reviewed Start action is the only route that can launch the Ollama executable.
func Call(ctx context.Context, config Config, action Action) (Result, error) {
	binding, err := localmodel.ReadRuntimeBinding(config.StateDir)
	if err != nil {
		return Result{}, err
	}
	if binding != nil {
		if result, err := request(ctx, *binding, action); err == nil {
			return result, nil
		}
		if binding.ChildPID > 0 && processAlive(binding.ChildPID) {
			return Result{}, errors.New("the runtime owner is unavailable; no process was adopted or killed")
		}
	}
	if action.Action == "runtime_status" {
		return Existing(ctx, config), nil
	}
	if action.Action != "runtime_review_start" {
		return Result{}, errors.New("refresh and review starting the owned runtime first")
	}
	executable, err := os.Executable()
	if err != nil {
		return Result{}, err
	}
	command := exec.Command(executable, "local-runtime-service")
	detach(command)
	environment := append([]string{}, os.Environ()...)
	environment = append(environment, "HOT_CROSS_BUNS_INTERNAL_COMMANDS=1", "HOT_CROSS_BUNS_STATE_DIR="+config.StateDir)
	command.Env = environment
	if err = command.Start(); err != nil {
		return Result{}, err
	}
	go func() { _ = command.Wait() }()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-deadline.C:
			return Result{}, errors.New("runtime controller startup was not confirmed; refresh before retrying")
		case <-ticker.C:
			binding, err = localmodel.ReadRuntimeBinding(config.StateDir)
			if err == nil && binding != nil {
				if result, err := request(ctx, *binding, action); err == nil {
					return result, nil
				}
			}
		}
	}
}
