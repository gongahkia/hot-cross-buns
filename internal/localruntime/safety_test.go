package localruntime

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
)

func TestPrivateControllerRejectsUnauthenticatedRequests(t *testing.T) {
	h := service(t)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	defer client.CloseIdleConnections()
	request := mustRequest("POST", h.binding.Endpoint+"/__hcb/runtime", `{"action":"runtime_review_start","request_id":"foreign"}`)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal(response.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(h.config.ModelsDir, "launched.json")); !os.IsNotExist(err) {
		t.Fatal("unauthenticated launch")
	}
}
func TestPeerVerificationHappensBeforeSendingHTTP(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.Copy(io.Discard, r.Body)
		w.WriteHeader(200)
	}))
	defer server.Close()
	client, err := localmodel.VerifiedHTTPClient(server.URL, func() error { return errors.New("foreign listener") })
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	_, err = client.Do(mustRequest("POST", server.URL+"/api/pull", `{"model":"private"}`))
	if err == nil {
		t.Fatal("foreign connection accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("sent request before peer verification")
	}
}
func TestTLSBindingDoesNotTrustAReplacementListener(t *testing.T) {
	h := service(t)
	var calls atomic.Int32
	foreign := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer foreign.Close()
	// Even if a different port is pointed at in private metadata, the original certificate remains pinned.
	binding := h.binding
	binding.Endpoint = foreign.URL
	data, _ := json.Marshal(binding)
	path := filepath.Join(localmodel.RuntimeDirectory(h.config.StateDir), "binding.json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.WriteFile(path, original, 0600)
	client, err := localmodel.HTTPClient(foreign.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	if _, err = client.Do(mustRequest("POST", foreign.URL+"/v1/chat/completions", `{"model":"qwen3:4b"}`)); err == nil {
		t.Fatal("trusted foreign TLS certificate")
	}
	if calls.Load() != 0 {
		t.Fatal("prompt reached foreign listener")
	}
}
func unitController(t *testing.T) *controller {
	t.Helper()
	store, err := openStorage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.close)
	models := t.TempDir()
	return &controller{store: store, config: Config{Executable: fakeBinary, ModelsDir: models, Host: generous}, binding: &localmodel.RuntimeBinding{Generation: nonce()}, state: "stopped"}
}
func TestExpiredChangedAndUnrecordableStartReviewsHaveNoEffect(t *testing.T) {
	for _, kind := range []string{"expired", "changed", "storage"} {
		t.Run(kind, func(t *testing.T) {
			c := unitController(t)
			review := c.action(Action{RequestID: nonce(), Action: "runtime_review_start"}).Review
			if review == nil {
				t.Fatal("missing review")
			}
			switch kind {
			case "expired":
				c.review.Expires = time.Now().Add(-time.Minute)
			case "changed":
				c.review.BinaryDigest = strings.Repeat("0", 64)
			case "storage":
				if err := c.store.root.Mkdir("operation.json", 0700); err != nil {
					t.Fatal(err)
				}
			}
			r := c.action(Action{RequestID: nonce(), Action: "runtime_start", ReviewID: review.ID, Generation: review.Generation})
			if r.Error == "" || c.child != nil || c.state != "stopped" {
				t.Fatalf("invalid start admitted: %+v", r)
			}
		})
	}
}
func TestControllerOwnerLeaseIsExclusive(t *testing.T) {
	h := service(t)
	if store, err := openStorage(h.config.StateDir); err == nil {
		store.close()
		t.Fatal("second controller acquired owner lease")
	}
}
func TestOfflineReceiptIsNotReplayed(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	store, err := openStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	binding := &localmodel.RuntimeBinding{Version: 1, Profile: localmodel.RuntimeProfile(root), Token: nonce(), Generation: nonce(), Endpoint: "https://127.0.0.1:1"}
	if _, err = store.certificate(binding); err != nil {
		t.Fatal(err)
	}
	if err = store.write("binding.json", binding); err != nil {
		t.Fatal(err)
	}
	if err = store.write("operation.json", Receipt{ID: nonce(), Action: "runtime_start", Phase: "prepared"}); err != nil {
		t.Fatal(err)
	}
	store.close()
	r := Existing(context.Background(), Config{StateDir: root, Executable: fakeBinary})
	if r.Status.State != "stopped" || r.Status.Receipt == nil || r.Status.Receipt.Phase != "uncertain" {
		t.Fatalf("offline intent relabeled or replayed: %+v", r)
	}
}

func TestUnconfirmedChildCannotBeReplacedByAnotherStart(t *testing.T) {
	c := unitController(t)
	c.child = &child{}
	c.failedStart()
	if c.state != "uncertain" {
		t.Fatal("unconfirmed child relabeled as stopped")
	}
	r := c.action(Action{RequestID: nonce(), Action: "runtime_review_start"})
	if r.Review != nil {
		t.Fatal("a second child could replace an unconfirmed process")
	}
}
