package localruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
)

var fakeBinary string

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "hcb-runtime-fixture-")
	if err != nil {
		panic(err)
	}
	fakeBinary = filepath.Join(directory, "ollama")
	if os.PathSeparator == '\\' {
		fakeBinary += ".exe"
	}
	command := exec.Command("go", "build", "-o", fakeBinary, "./testdata/fakeollama")
	if output, err := command.CombinedOutput(); err != nil {
		fmt.Fprintln(os.Stderr, string(output), err)
		os.RemoveAll(directory)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(directory)
	os.Exit(code)
}
func generous() localmodel.Host {
	return localmodel.Host{OS: "linux", Architecture: "amd64", TotalMemoryBytes: 128 << 30, AvailableMemoryBytes: 100 << 30, AvailableDiskBytes: 1000 << 30}
}

type harness struct {
	config  Config
	binding localmodel.RuntimeBinding
}

func eventually(t *testing.T, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if f() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not reached")
}
func service(t *testing.T) *harness {
	t.Helper()
	directory := t.TempDir()
	h := &harness{config: Config{StateDir: filepath.Join(directory, "state"), ModelsDir: filepath.Join(directory, "models"), Executable: fakeBinary, Host: generous}}
	if err := os.Mkdir(h.config.ModelsDir, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", h.config.StateDir)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, h.config) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(20 * time.Second):
			t.Error("controller shutdown timeout")
		}
	})
	eventually(t, func() bool {
		binding, err := localmodel.ReadRuntimeBinding(h.config.StateDir)
		if err != nil || binding == nil {
			return false
		}
		h.binding = *binding
		_, err = request(context.Background(), h.binding, Action{RequestID: nonce(), Action: "runtime_status"})
		return err == nil
	})
	return h
}
func (h *harness) call(t *testing.T, a Action) Result {
	t.Helper()
	a.RequestID = nonce()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r, err := request(ctx, h.binding, a)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func (h *harness) status(t *testing.T) Status {
	t.Helper()
	return h.call(t, Action{Action: "runtime_status"}).Status
}
func (h *harness) admit(t *testing.T, kind, model string) Result {
	t.Helper()
	r := h.call(t, Action{Action: "runtime_review_" + kind, ModelID: model})
	if r.Error != "" || r.Review == nil {
		t.Fatalf("review: %+v", r)
	}
	return h.call(t, Action{Action: r.Review.Action, ModelID: model, ReviewID: r.Review.ID, Generation: r.Review.Generation})
}
func (h *harness) start(t *testing.T) {
	t.Helper()
	r := h.admit(t, "start", "")
	if !r.Confirmed || r.Error != "" {
		t.Fatalf("start: %+v", r)
	}
	eventually(t, func() bool { return h.status(t).State == "running" })
}
func (h *harness) http(t *testing.T, path, body string) (int, string) {
	t.Helper()
	client, err := localmodel.HTTPClient(h.binding.Endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	method := "GET"
	if body != "" {
		method = "POST"
	}
	r, err := client.Do(mustRequest(method, h.binding.Endpoint+path, body))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return r.StatusCode, string(data)
}
func mustRequest(method, url, body string) *http.Request {
	r, err := http.NewRequest(method, url, bytes.NewBufferString(body))
	if err != nil {
		panic(err)
	}
	r.Header.Set("Content-Type", "application/json")
	return r
}
func TestReviewedLifecycleIsIsolatedAndSingleUse(t *testing.T) {
	t.Setenv("HCB_TEST_SECRET", "must-not-reach-child")
	h := service(t)
	if h.status(t).State != "stopped" {
		t.Fatal("status started runtime")
	}
	r := h.call(t, Action{Action: "runtime_review_start"})
	if r.Review == nil {
		t.Fatal(r.Error)
	}
	if _, err := os.Stat(filepath.Join(h.config.ModelsDir, "launched.json")); !os.IsNotExist(err) {
		t.Fatal("review started process")
	}
	wrong := h.call(t, Action{Action: "runtime_start", ReviewID: r.Review.ID, Generation: "wrong"})
	if wrong.Confirmed {
		t.Fatal("accepted wrong generation")
	}
	a := Action{Action: "runtime_start", ReviewID: r.Review.ID, Generation: r.Review.Generation}
	if got := h.call(t, a); !got.Confirmed || got.Error != "" {
		t.Fatal(got.Error)
	}
	if h.call(t, a).Confirmed {
		t.Fatal("replayed single-use review")
	}
	eventually(t, func() bool { return h.status(t).State == "running" })
	data, err := os.ReadFile(filepath.Join(h.config.ModelsDir, "launched.json"))
	if err != nil {
		t.Fatal(err)
	}
	var launch struct {
		PID           int
		Cloud, Secret string
	}
	if json.Unmarshal(data, &launch) != nil || launch.PID <= 1 || launch.Cloud != "1" || launch.Secret != "" {
		t.Fatalf("bad child environment %s", data)
	}
	if code, _ := h.http(t, "/api/version", ""); code != 200 {
		t.Fatal(code)
	}
	for _, path := range []string{"/api/delete", "/api/pull", "/api/create", "/api/copy"} {
		if code, _ := h.http(t, path, `{"model":"qwen3:4b"}`); code != 403 {
			t.Fatal(path, code)
		}
	}
	if code, _ := h.http(t, "/v1/chat/completions", `{"model":"unreviewed:cloud"}`); code != 403 {
		t.Fatal(code)
	}
	if code, body := h.http(t, "/v1/chat/completions", `{"model":"qwen3:4b","messages":[]}`); code != 200 || !strings.Contains(body, "fixture") {
		t.Fatal(code, body)
	}
	if got := h.admit(t, "stop", ""); !got.Confirmed {
		t.Fatal(got.Error)
	}
	eventually(t, func() bool { return h.status(t).State == "stopped" })
	if processAlive(launch.PID) {
		t.Fatal("owned child still running")
	}
	entries, err := filepath.Glob(filepath.Join(localmodel.RuntimeDirectory(h.config.StateDir), "operation-*.json"))
	if err != nil || len(entries) != 2 {
		t.Fatal(entries, err)
	}
}
func TestActiveInferenceBlocksStopAndDownloadEvenAfterReview(t *testing.T) {
	h := service(t)
	h.start(t)
	review := h.call(t, Action{Action: "runtime_review_stop"}).Review
	if review == nil {
		t.Fatal("missing stop review")
	}
	hold := filepath.Join(h.config.ModelsDir, "hold")
	if err := os.WriteFile(hold, []byte("hold"), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); h.http(t, "/v1/chat/completions", `{"model":"qwen3:4b","messages":[]}`) }()
	eventually(t, func() bool { return h.status(t).Active > 0 })
	if r := h.call(t, Action{Action: "runtime_stop", ReviewID: review.ID, Generation: review.Generation}); r.Confirmed || !strings.Contains(r.Error, "inference") {
		t.Fatal(r)
	}
	if r := h.call(t, Action{Action: "runtime_review_download", ModelID: "qwen3-4b"}); r.Review != nil {
		t.Fatal("admitted pull during inference")
	}
	if err := os.Remove(hold); err != nil {
		t.Fatal(err)
	}
	<-done
	eventually(t, func() bool { return h.status(t).Active == 0 })
}
func TestDownloadReviewProgressCancellationAndNoReplacement(t *testing.T) {
	h := service(t)
	h.start(t)
	if r := h.admit(t, "download", "qwen3-4b"); !r.Confirmed {
		t.Fatal(r.Error)
	}
	eventually(t, func() bool {
		s := h.status(t)
		return s.Receipt != nil && s.Receipt.Phase == "completed" && s.Receipt.Action == "runtime_download"
	})
	if r := h.call(t, Action{Action: "runtime_review_download", ModelID: "qwen3-4b"}); r.Review != nil || !strings.Contains(r.Error, "already installed") {
		t.Fatal(r)
	}
	if err := os.WriteFile(filepath.Join(h.config.ModelsDir, "slow-pull"), []byte("hold"), 0600); err != nil {
		t.Fatal(err)
	}
	if r := h.admit(t, "download", "qwen3-8b"); !r.Confirmed {
		t.Fatal(r.Error)
	}
	eventually(t, func() bool { return h.status(t).Receipt.Completed == 25 })
	s := h.status(t)
	if r := h.call(t, Action{Action: "runtime_cancel_download", ReviewID: s.Receipt.ID, Generation: s.Generation}); r.Error != "" {
		t.Fatal(r.Error)
	}
	eventually(t, func() bool { return h.status(t).Receipt.Phase == "uncertain" })
	if r := h.call(t, Action{Action: "runtime_review_download", ModelID: "qwen3-8b"}); r.Review != nil {
		t.Fatal("retried uncertain download")
	}
}
