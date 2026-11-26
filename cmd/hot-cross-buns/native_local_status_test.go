package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

func TestNativeLocalStatusReadOnlyExactAndUnknownStates(t *testing.T) {
	b := nativeProviderFixture(t)
	var requests atomic.Int32
	var loadedKnown atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "GET" {
			t.Error("status attempted mutation")
		}
		switch r.URL.Path {
		case "/api/version":
			fmt.Fprint(w, `{"version":"fixture-v1"}`)
		case "/api/tags":
			fmt.Fprint(w, `{"models":[{"name":"qwen3:4b","size":2500000000,"digest":"sha256:fixture"},{"name":"unknown-size"}]}`)
		case "/api/ps":
			if loadedKnown.Load() {
				fmt.Fprint(w, `{"models":[]}`)
			} else {
				w.WriteHeader(404)
			}
		default:
			t.Error("unexpected endpoint", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	if err := b.settings.Update(func(s *config.Settings) error {
		s.CustomProviders = []config.CustomProvider{{ID: "hot-cross-buns-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		s.Defaults = config.Defaults{Provider: "openai", Model: "future-cloud"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(b.settings.Path())
	b.review = &nativeProviderReview{}
	review := b.review
	r := b.Apply(modelcatalog.NativeProviderAction{RequestID: "observe-1", Action: "local_status"})
	if r.Error != "" || r.Local == nil {
		t.Fatal("status failed", r.Error)
	}
	s := r.Local
	if s.ResultID == "" || s.ObservedAt == "" || !s.Reachable || !s.InstalledKnown || s.LoadedKnown || s.SelectedProvider != "openai" || len(s.Installed) != 2 {
		t.Fatalf("incorrect observation: %+v", s)
	}
	if s.Installed[0].Loaded != nil || s.Installed[1].Size != nil || s.Installed[0].Digest != "sha256:fixture" {
		t.Fatal("unknown reported as known")
	}
	if b.review != review {
		t.Fatal("read-only inspection discarded a reviewed credential operation")
	}
	loadedKnown.Store(true)
	again := b.Apply(modelcatalog.NativeProviderAction{RequestID: "observe-2", Action: "local_status"})
	if again.Local == nil || !again.Local.LoadedKnown || *again.Local.Installed[0].Loaded || again.Local.ResultID == s.ResultID {
		t.Fatal("loaded state/result identity")
	}
	after, _ := os.ReadFile(b.settings.Path())
	if !bytes.Equal(before, after) || requests.Load() != 6 {
		t.Fatal("status side effects or unexpected requests")
	}
	malformed := b.Apply(modelcatalog.NativeProviderAction{RequestID: "bad", Action: "local_status", ReplaceKey: true})
	if malformed.Error == "" || requests.Load() != 6 {
		t.Fatal("mutation input accepted")
	}
	requireNoProviderSecret(t, r)
}
func TestNativeLocalStatusRejectsSettingsChangedDuringInspection(t *testing.T) {
	b := nativeProviderFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/version" {
			if err := b.settings.Update(func(s *config.Settings) error {
				s.Defaults = config.Defaults{Provider: "openai", Model: "newer"}
				return nil
			}); err != nil {
				t.Error(err)
			}
			fmt.Fprint(w, `{"version":"fixture"}`)
		} else {
			fmt.Fprint(w, `{"models":[]}`)
		}
	}))
	defer server.Close()
	b.settings.Update(func(s *config.Settings) error {
		s.CustomProviders = []config.CustomProvider{{ID: "hot-cross-buns-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		return nil
	})
	r := b.Apply(modelcatalog.NativeProviderAction{RequestID: "stale", Action: "local_status"})
	if r.Local != nil || !r.Conflict || r.Error == "" {
		t.Fatal("stale observation published")
	}
}

func TestStoppedOwnedRuntimeStillShowsCatalogWithoutContactingConfiguredRuntime(t *testing.T) {
	b := nativeProviderFixture(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fmt.Fprint(w, `{"models":[]}`)
	}))
	defer server.Close()
	if err := b.settings.Update(func(s *config.Settings) error {
		s.CustomProviders = []config.CustomProvider{{ID: "hot-cross-buns-local", BaseURL: server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	r := b.Apply(modelcatalog.NativeProviderAction{RequestID: "offline", Action: "local_status", AppOwned: true})
	if r.Error != "" || r.Local == nil || len(r.Local.Catalog) == 0 || requests.Load() != 0 {
		t.Fatal("offline catalog unavailable or inspected another runtime", r.Error)
	}
	if r.Local.Reachable || r.Local.InstalledKnown || r.Local.LoadedKnown {
		t.Fatal("offline runtime was reported as verified")
	}
	for _, row := range r.Local.Catalog {
		if row.Downloaded != nil || row.Loaded != nil || row.Digest != "" {
			t.Fatal("invented installation state without an observation")
		}
	}
}
func TestNativeLocalBridgeCompletionIdentityAndNoOwnerMutation(t *testing.T) {
	var out bytes.Buffer
	result := modelcatalog.NativeProviderResult{RequestID: "read-status", Action: "local_status", Local: &modelcatalog.NativeLocalStatus{ResultID: "result"}}
	bridge := &uiBridgeModel{model: workapp.New(workapp.Config{BridgeMode: true, ManagedSessions: true, NativeProviders: func(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult { return result }}), out: json.NewEncoder(&out)}
	before := bridge.model.BridgeState()
	a := modelcatalog.NativeProviderAction{RequestID: "read-status", Action: "local_status"}
	_, cmd := bridge.Update(uiFrame{Type: "native_provider", NativeProvider: &a, Nonce: "ack"})
	if cmd == nil || bridge.model.BridgeState().NativeProviderResult != nil {
		t.Fatal("admission confused with result")
	}
	bridge.Update(cmd())
	after := bridge.model.BridgeState()
	if after.NativeProviderResult == nil || after.NativeProviderResult.Local.ResultID != "result" {
		t.Fatal("missing exact read result")
	}
	before.NativeProviderResult = after.NativeProviderResult
	// A read result may change the snapshot metadata only, not the retained Work or approval state.
	if !reflect.DeepEqual(before.PendingApproval, after.PendingApproval) {
		t.Fatal("status changed approval")
	}
}
