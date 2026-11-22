package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gongahkia/gator/internal/agent"
	"github.com/gongahkia/gator/internal/config"
	"github.com/gongahkia/gator/internal/modelcatalog"
)

func TestManagedLocalInferenceUsesContainedTransport(t *testing.T) {
	useGenerousLocalModelHost(t)
	t.Setenv("GATOR_CONFIG_DIR", t.TempDir())
	t.Setenv("GATOR_STATE_DIR", t.TempDir())
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "" {
			t.Error("unexpected local credential")
		}
		if r.URL.Path != "/v1/chat/completions" || r.Method != "POST" {
			t.Error("inference protocol changed")
		}
		w.Header().Set("Location", "https://off-host.invalid/never-contact")
		w.WriteHeader(307)
	}))
	defer server.Close()
	provider := config.CustomProvider{ID: "gator-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}
	executor, err := newCustomExecutorConfiguration(config.Default(), provider, "qwen3:4b", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := executor.Model.Complete(context.Background(), agent.TurnRequest{}); err == nil {
		t.Fatal("redirect accepted")
	}
	if calls.Load() != 1 {
		t.Fatal("unexpected request count")
	}
	provider.APIKeyEnv = "FIXTURE_API_KEY"
	t.Setenv("FIXTURE_API_KEY", "INERT_NEVER_TRANSMIT")
	if _, err := newCustomExecutorConfiguration(config.Default(), provider, "qwen3:4b", ""); err == nil {
		t.Fatal("managed local credential accepted")
	}
	if calls.Load() != 1 {
		t.Fatal("credential check made a request")
	}
}
func BenchmarkNativeLocalReadOnlyStatus(b *testing.B) {
	store, _ := config.New(b.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			b.Fatal("mutation")
		}
		if r.URL.Path == "/api/version" {
			fmt.Fprint(w, `{"version":"fixture"}`)
		} else {
			fmt.Fprint(w, `{"models":[]}`)
		}
	}))
	defer server.Close()
	if err := store.Update(func(s *config.Settings) error {
		s.CustomProviders = []config.CustomProvider{{ID: "gator-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		return nil
	}); err != nil {
		b.Fatal(err)
	}
	backend := &nativeProviderBackend{settings: store, stateDir: b.TempDir()}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r := backend.Apply(modelcatalog.NativeProviderAction{RequestID: fmt.Sprintf("observe-%d", i), Action: "local_status"})
		if r.Local == nil || r.Error != "" {
			b.Fatal("status failed")
		}
	}
}

func TestManagedLocalInferenceRejectsOversizedCompletedJSON(t *testing.T) {
	useGenerousLocalModelHost(t)
	t.Setenv("GATOR_CONFIG_DIR", t.TempDir())
	t.Setenv("GATOR_STATE_DIR", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"inert"}}]}`)
		fmt.Fprint(w, strings.Repeat(" ", 2*1024*1024))
	}))
	defer server.Close()
	p := config.CustomProvider{ID: "gator-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}
	executor, err := newCustomExecutorConfiguration(config.Default(), p, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := executor.Model.Complete(context.Background(), agent.TurnRequest{}); err == nil {
		t.Fatal("oversized inference response accepted")
	}
}
