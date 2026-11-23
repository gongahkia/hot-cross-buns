package localruntime

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

type child struct {
	command *exec.Cmd
	done    chan struct{}
	address string
	binary  string
}
type controller struct {
	mu       sync.Mutex
	workers  sync.WaitGroup
	closing  bool
	config   Config
	store    *storage
	binding  *localmodel.RuntimeBinding
	state    string
	issue    string
	active   int
	child    *child
	review   *Review
	receipt  *Receipt
	cancel   context.CancelFunc
	shutdown func()
	last     time.Time
}

func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
}
func binaryPath(config Config) (string, error) {
	path := config.Executable
	if path == "" {
		path, _ = exec.LookPath("ollama")
	}
	if path == "" {
		for _, candidate := range []string{"/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"} {
			if info, e := os.Stat(candidate); e == nil && info.Mode().IsRegular() {
				path = candidate
				break
			}
		}
	}
	if path == "" {
		return "", errors.New("Install Ollama, then refresh. No installer is run automatically.")
	}
	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1024*1024*1024 {
		return "", errors.New("Ollama must be an ordinary installed executable")
	}
	return path, nil
}
func binaryDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, io.LimitReader(file, 1024*1024*1024+1)); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func (c *controller) status() Status {
	path, pathErr := binaryPath(c.config)
	value := Status{Generation: c.binding.Generation, State: c.state, Endpoint: c.binding.Endpoint, Binary: path, Storage: c.config.ModelsDir, Active: c.active, Available: pathErr == nil, Issue: c.issue}
	if c.receipt != nil {
		copy := *c.receipt
		value.Receipt = &copy
	}
	return value
}
func (c *controller) record(phase, issue string) error {
	c.receipt.Phase = phase
	c.receipt.Issue = issue
	c.receipt.Updated = time.Now().UTC()
	if err := c.store.write("operation.json", c.receipt); err != nil {
		return err
	}
	return c.store.archive(*c.receipt)
}
func (c *controller) action(a Action) Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.last = time.Now()
	result := Result{}
	finish := func(message string) Result { result.Status = c.status(); result.Error = message; return result }
	if c.closing {
		return finish("Runtime controller is closing. Refresh first.")
	}
	if len(a.RequestID) < 1 || len(a.RequestID) > 128 {
		return finish("Invalid runtime request identity.")
	}
	if a.Action == "runtime_status" {
		return finish("")
	}
	if a.Action == "runtime_cancel_review" {
		if c.review != nil && (a.ReviewID != c.review.ID || a.Generation != c.review.Generation) {
			return finish("The review changed. Refresh first.")
		}
		c.review = nil
		if c.state == "stopped" {
			c.last = time.Now().Add(-3 * time.Minute)
		}
		return finish("")
	}
	if a.Action == "runtime_cancel_download" {
		if c.receipt == nil || c.receipt.Action != "runtime_download" || c.receipt.Phase != "working" || a.ReviewID != c.receipt.ID || a.Generation != c.binding.Generation {
			return finish("This download is no longer selected.")
		}
		if c.cancel != nil {
			c.cancel()
		}
		return finish("")
	}
	if strings.HasPrefix(a.Action, "runtime_review_") {
		c.review = nil
		if c.state == "starting" || c.state == "stopping" || c.cancel != nil {
			return finish("Wait for the current local operation.")
		}
		operation := strings.TrimPrefix(a.Action, "runtime_review_")
		review := &Review{ID: nonce(), Generation: c.binding.Generation, Action: "runtime_" + operation, Expires: time.Now().Add(2 * time.Minute)}
		switch operation {
		case "start":
			if c.state != "stopped" {
				return finish("The app-owned runtime is already running or needs attention.")
			}
			path, err := binaryPath(c.config)
			if err != nil {
				return finish(err.Error())
			}
			digest, err := binaryDigest(path)
			if err != nil {
				return finish("The installed executable could not be inspected.")
			}
			review.Binary = path
			review.BinaryDigest = digest
			review.Storage = c.config.ModelsDir
			review.Notice = "Start this installed executable with separate app-owned model storage. Existing Ollama processes are untouched. It stays available for background tasks until you stop it. No model is selected or run."
		case "stop":
			if c.state != "running" || c.child == nil {
				return finish("There is no running app-owned process to stop.")
			}
			if c.active != 0 {
				return finish("Local inference is active. Wait for it to finish before stopping.")
			}
			review.Notice = "Stop only the process started by Hot Cross Buns. Model files and future selections stay saved. Queued or scheduled local tasks will need the runtime started again."
		case "download":
			if c.state != "running" || c.child == nil {
				return finish("Start the app-owned runtime first.")
			}
			if c.active != 0 {
				return finish("Wait for active local inference before downloading.")
			}
			if c.receipt != nil && c.receipt.Action == "runtime_download" && c.receipt.Phase == "uncertain" {
				return finish("Stop and restart the owned runtime before reviewing this interrupted download again.")
			}
			model, ok := localmodel.Resolve(a.ModelID)
			if !ok || model.ID != a.ModelID {
				return finish("Choose a reviewed catalog model.")
			}
			host := c.config.Host
			if host == nil {
				host = func() localmodel.Host { return localmodel.DetectHostAt(c.config.ModelsDir) }
			}
			if eligibility := localmodel.Assess(model, host()); !eligibility.Allowed {
				return finish(eligibility.Reason)
			}
			client, _ := localmodel.NewVerifiedClient("http://"+c.child.address, func() error { return c.verify(c.child) })
			ctx, cancel := timeout(context.Background())
			defer cancel()
			models, err := client.Models(ctx)
			if err != nil {
				return finish("Installed inventory could not be verified.")
			}
			for _, installed := range models {
				if installed.Name == model.OllamaModel {
					return finish("This tag is already installed. Replacing existing models is not supported.")
				}
			}
			review.ModelID = model.ID
			review.Tag = model.OllamaModel
			review.Size = model.Download
			review.Storage = c.config.ModelsDir
			review.Notice = "Download this curated package into the app-owned store. No existing tag is replaced, no model is selected, and no inference is started. The downloaded digest is reviewed separately before future selection."
		default:
			return finish("Unsupported runtime review.")
		}
		if review.ID == "" {
			return finish("A review identity could not be created.")
		}
		c.review = review
		copy := *review
		result.Review = &copy
		return finish("")
	}
	review := c.review
	if review == nil || a.ReviewID != review.ID || a.Generation != review.Generation || a.Action != review.Action || time.Now().After(review.Expires) || a.ModelID != review.ModelID {
		return finish("The runtime review changed or expired. Review again; nothing was replayed.")
	}
	if c.active != 0 {
		return finish("Local inference started after review. Wait and review again.")
	}
	c.review = nil
	if c.receipt != nil && c.receipt.RequestID == a.RequestID {
		return finish("This operation was already admitted. Refresh its recorded outcome.")
	}
	c.receipt = &Receipt{ID: nonce(), RequestID: a.RequestID, Action: a.Action, ModelID: review.ModelID, Tag: review.Tag}
	if err := c.record("prepared", ""); err != nil {
		return finish("A durable operation intent could not be recorded. Nothing was started.")
	}
	result.Confirmed = true
	switch a.Action {
	case "runtime_start":
		digest, err := binaryDigest(review.Binary)
		if err != nil || digest != review.BinaryDigest {
			c.record("failed", "The installed executable changed.")
			return finish("The executable changed. Review again.")
		}
		c.state = "starting"
		c.workers.Add(1)
		go func() { defer c.workers.Done(); c.start(*review) }()
	case "runtime_stop":
		if c.child == nil || c.state != "running" {
			c.record("failed", "The owned process changed.")
			return finish("The owned process changed. Refresh first.")
		}
		c.state = "stopping"
		c.workers.Add(1)
		go func() { defer c.workers.Done(); c.stop() }()
	case "runtime_download":
		if c.child == nil || c.state != "running" {
			c.record("failed", "The owned process stopped.")
			return finish("Start the app-owned runtime again.")
		}
		ctx, cancel := context.WithCancel(context.Background())
		c.cancel = cancel
		if err := c.record("working", ""); err != nil {
			cancel()
			c.cancel = nil
			return finish("Download intent could not be recorded.")
		}
		c.workers.Add(1)
		go func() { defer c.workers.Done(); c.download(ctx, *review) }()
	default:
		c.record("failed", "Unsupported operation.")
		return finish("Unsupported runtime operation.")
	}
	return finish("")
}
func (c *controller) start(review Review) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		c.failedStart()
		return
	}
	address := listener.Addr().String()
	listener.Close()
	command := exec.Command(review.Binary, "serve")
	environment := []string{}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR":
			environment = append(environment, entry)
		}
	}
	command.Env = append(environment, "OLLAMA_HOST="+address, "OLLAMA_MODELS="+c.config.ModelsDir, "OLLAMA_ORIGINS=", "OLLAMA_NO_CLOUD=1")
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err = command.Start(); err != nil {
		c.failedStart()
		return
	}
	owned := &child{command: command, done: make(chan struct{}), address: address, binary: review.Binary}
	c.mu.Lock()
	c.child = owned
	c.binding.ChildPID = command.Process.Pid
	err = c.store.write("binding.json", c.binding)
	c.mu.Unlock()
	go func() {
		defer close(owned.done)
		_ = command.Wait()
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.child == owned {
			c.child = nil
			c.binding.ChildPID = 0
			if c.state == "running" || c.state == "starting" {
				c.state = "stopped"
				c.issue = "The owned runtime exited. Inspect and review before restarting."
			}
			_ = c.store.write("binding.json", c.binding)
		}
	}()
	if err != nil {
		c.abandonStart(owned)
		c.failedStart()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	client, _ := localmodel.NewVerifiedClient("http://"+address, func() error { return c.verify(owned) })
	for {
		if _, err = client.Version(ctx); err == nil {
			if err = c.verify(owned); err == nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			c.abandonStart(owned)
			c.failedStart()
			return
		case <-owned.done:
			c.failedStart()
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.child != owned {
		_ = c.record("failed", "The owned runtime exited before startup was confirmed.")
		return
	}
	c.state = "running"
	c.issue = ""
	if err := c.record("completed", ""); err != nil {
		c.issue = "Runtime started; receipt finalization is uncertain."
		c.receipt.Phase = "uncertain"
	}
}
func (c *controller) abandonStart(owned *child) {
	_ = owned.command.Process.Kill()
	select {
	case <-owned.done:
	case <-time.After(2 * time.Second):
	}
}
func (c *controller) failedStart() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = "stopped"
	if c.child != nil {
		c.state = "uncertain"
	}
	c.issue = "The app-owned runtime could not be verified. No external runtime was adopted."
	if c.receipt != nil {
		_ = c.record("failed", c.issue)
	}
}
func (c *controller) verify(owned *child) error {
	select {
	case <-owned.done:
		return errors.New("owned process exited")
	default:
	}
	check := c.config.Verify
	if check == nil {
		check = verifyListener
	}
	return check(owned.command.Process.Pid, owned.binary, owned.address)
}
func (c *controller) stop() {
	c.mu.Lock()
	owned := c.child
	c.mu.Unlock()
	if owned == nil {
		c.failedStart()
		return
	}
	// The handle was returned by our own Start; no PID loaded from disk is killed.
	err := terminate(owned)
	if err == nil || errors.Is(err, os.ErrProcessDone) {
		select {
		case <-owned.done:
		case <-time.After(5 * time.Second):
			_ = owned.command.Process.Kill()
			select {
			case <-owned.done:
			case <-time.After(2 * time.Second):
				err = errors.New("owned process exit unconfirmed")
			}
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		c.state = "uncertain"
		c.issue = "Owned runtime shutdown is unconfirmed."
		_ = c.record("uncertain", c.issue)
		return
	}
	c.state = "stopped"
	c.issue = ""
	c.binding.ChildPID = 0
	if e := c.store.write("binding.json", c.binding); e != nil {
		c.issue = "Runtime stopped; metadata finalization is uncertain."
	}
	if e := c.record("completed", c.issue); e != nil {
		c.receipt.Phase = "uncertain"
		c.issue = "Runtime stopped; receipt finalization is uncertain."
	}
}
func (c *controller) download(ctx context.Context, review Review) {
	c.mu.Lock()
	owned := c.child
	c.mu.Unlock()
	issue := ""
	phase := "completed"
	if owned == nil || c.verify(owned) != nil {
		issue = "The owned runtime changed."
		phase = "failed"
	} else {
		client, _ := localmodel.NewVerifiedClient("http://"+owned.address, func() error { return c.verify(owned) })
		models, err := client.Models(ctx)
		if err == nil {
			for _, m := range models {
				if m.Name == review.Tag {
					err = errors.New("tag already installed")
				}
			}
		}
		if err == nil {
			model, _ := localmodel.Resolve(review.ModelID)
			host := c.config.Host
			if host == nil {
				host = func() localmodel.Host { return localmodel.DetectHostAt(c.config.ModelsDir) }
			}
			if eligibility := localmodel.Assess(model, host()); !eligibility.Allowed {
				err = errors.New("host eligibility changed")
			}
			if err == nil {
				err = client.Pull(ctx, model, func(p localmodel.Progress) {
					c.mu.Lock()
					defer c.mu.Unlock()
					if c.receipt != nil {
						c.receipt.Progress = clean(p.Status)
						if len(c.receipt.Progress) > 160 {
							c.receipt.Progress = c.receipt.Progress[:160]
						}
						c.receipt.Completed = p.Completed
						c.receipt.Total = p.Total
					}
				})
			}
		}
		if err != nil {
			phase = "uncertain"
			issue = "Download completion is unconfirmed. Refresh inventory; stop and restart before retrying. Existing tags were not replaced."
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	if err := c.record(phase, issue); err != nil {
		c.receipt.Phase = "uncertain"
		c.issue = "Download outcome could not be finalized. Inspect private receipt storage."
	}
}
func (c *controller) proxy(w http.ResponseWriter, r *http.Request) {
	read := r.Method == "GET" && (r.URL.Path == "/api/version" || r.URL.Path == "/api/tags" || r.URL.Path == "/api/ps" || r.URL.Path == "/v1/models")
	inference := r.Method == "POST" && (r.URL.Path == "/v1/chat/completions" || r.URL.Path == "/v1/embeddings" || r.URL.Path == "/api/chat" || r.URL.Path == "/api/generate" || r.URL.Path == "/api/embed" || r.URL.Path == "/api/embeddings")
	if !read && !inference {
		http.Error(w, "Unsupported local inference route", http.StatusForbidden)
		return
	}
	if inference {
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*1024*1024))
		var input struct {
			Model string `json:"model"`
		}
		if err != nil || json.Unmarshal(data, &input) != nil {
			http.Error(w, "Invalid local model request", http.StatusBadRequest)
			return
		}
		model, ok := localmodel.Resolve(input.Model)
		if !ok || model.OllamaModel != input.Model {
			http.Error(w, "Only installed curated local models are allowed", http.StatusForbidden)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(data))
	}
	c.mu.Lock()
	owned := c.child
	if c.state != "running" || owned == nil || (inference && c.cancel != nil) {
		c.mu.Unlock()
		http.Error(w, "App-owned runtime is unavailable", http.StatusServiceUnavailable)
		return
	}
	c.active++
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.active--; c.mu.Unlock() }()
	target, _ := url.Parse("http://" + owned.address)
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		director(request)
		request.Header.Del(localmodel.RuntimeTokenHeader)
		request.Header.Del("Authorization")
		request.Header.Del("Cookie")
	}
	proxy.Transport = &http.Transport{Proxy: nil, DisableCompression: true, ResponseHeaderTimeout: 5 * time.Minute, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != owned.address {
			return nil, errors.New("runtime origin changed")
		}
		conn, err := (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "tcp4", address)
		if err != nil {
			return nil, err
		}
		if err = c.verify(owned); err != nil {
			conn.Close()
			return nil, err
		}
		return conn, nil
	}}
	defer proxy.Transport.(*http.Transport).CloseIdleConnections()
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		http.Error(w, "Owned runtime request failed", http.StatusBadGateway)
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024*1024)
	proxy.ServeHTTP(w, r)
}
func modelsDirectory(stateDir string) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(cache, "hot-cross-buns", "local-runtime", localmodel.RuntimeProfile(stateDir), "models")
	if err = privatefs.MkdirAll(path); err != nil {
		return "", err
	}
	return path, nil
}
