package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/gator/internal/auth"
	"github.com/gongahkia/gator/internal/config"
	"github.com/gongahkia/gator/internal/localmodel"
	"github.com/gongahkia/gator/internal/modelcatalog"
)

type localSelectFixture struct {
	b         *nativeProviderBackend
	server    *httptest.Server
	digest    atomic.Value
	mutations atomic.Int32
	requests  atomic.Int32
	missing   atomic.Bool
	mu        sync.RWMutex
	intercept func(*http.Request)
}

func newLocalSelectFixture(t *testing.T) *localSelectFixture {
	t.Helper()
	useGenerousLocalModelHost(t)
	f := &localSelectFixture{b: nativeProviderFixture(t)}
	f.digest.Store(strings.Repeat("a", 64))
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests.Add(1)
		if r.Method != "GET" {
			f.mutations.Add(1)
			http.Error(w, "forbidden", 405)
			return
		}
		f.mu.RLock()
		intercept := f.intercept
		f.mu.RUnlock()
		if intercept != nil {
			intercept(r)
		}
		switch r.URL.Path {
		case "/api/version":
			fmt.Fprint(w, `{"version":"fixture"}`)
		case "/api/tags":
			if f.missing.Load() {
				fmt.Fprint(w, `{"models":[]}`)
			} else {
				fmt.Fprintf(w, `{"models":[{"name":"qwen3:4b","size":2500000000,"digest":"%s"}]}`, f.digest.Load().(string))
			}
		case "/api/ps":
			fmt.Fprint(w, `{"models":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.server.Close)
	if err := f.b.settings.Update(func(s *config.Settings) error {
		s.Defaults = config.Defaults{Provider: "openai", Model: "cloud-fixture"}
		s.CustomProviders = []config.CustomProvider{{ID: "gator-local", BaseURL: f.server.URL + "/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return f
}
func (f *localSelectFixture) review(t *testing.T) *modelcatalog.NativeLocalSelectionReview {
	t.Helper()
	r := f.b.Apply(modelcatalog.NativeProviderAction{RequestID: "review-local", Action: "local_review_select", ModelID: "qwen3-4b"})
	if r.Error != "" || r.LocalReview == nil {
		t.Fatal("review failed", r.Error)
	}
	return r.LocalReview
}
func (f *localSelectFixture) selectRequest(review *modelcatalog.NativeLocalSelectionReview) modelcatalog.NativeProviderAction {
	return modelcatalog.NativeProviderAction{RequestID: "select-local", Action: "local_select", ModelID: review.ModelID, ReviewID: review.ID, Generation: review.Generation}
}

func TestNativeLocalSelectionReviewPublicationReceiptRestartAndReconcile(t *testing.T) {
	f := newLocalSelectFixture(t)
	before, _ := f.b.settings.Load()
	review := f.review(t)
	afterReview, _ := f.b.settings.Load()
	if !reflect.DeepEqual(before, afterReview) {
		t.Fatal("review mutated configuration")
	}
	if r, _ := localmodel.NewSelectionReceipts(f.b.stateDir).Read(); r != nil {
		t.Fatal("review created mutation receipt")
	}
	result := f.b.Apply(f.selectRequest(review))
	if !result.Confirmed || !result.Changed || result.LocalReceipt == nil || result.LocalReceipt.Phase != "published" {
		t.Fatal("publication unconfirmed", result.Error)
	}
	current, err := f.b.settings.Load()
	p, _ := configuredCustomProvider(current, "gator-local")
	if err != nil || current.Defaults.Provider != "gator-local" || current.Defaults.Model != "qwen3:4b" || p.ModelDigests["qwen3:4b"] != f.digest.Load().(string) {
		t.Fatal("exact future selection not persisted", err)
	}
	record, err := localmodel.NewSelectionReceipts(f.b.stateDir).Read()
	if err != nil || record.ID != result.LocalReceipt.ID || record.Generation != review.Generation || record.SettingsRevision != review.SettingsRevision {
		t.Fatal("receipt identity changed", err)
	}
	info, err := os.Stat(localmodel.NewSelectionReceipts(f.b.stateDir).Directory + "/selection.json")
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("receipt permissions", err)
	}
	requests := f.requests.Load()
	again := f.b.Apply(f.selectRequest(review))
	if again.Confirmed || again.Error == "" || f.requests.Load() != requests {
		t.Fatal("replayed mutation")
	}
	restarted := &nativeProviderBackend{settings: f.b.settings, stateDir: f.b.stateDir}
	r := restarted.Apply(modelcatalog.NativeProviderAction{RequestID: "read-after-restart", Action: "local_status"})
	if r.LocalReceipt == nil || r.FutureSelection.Provider != "gator-local" {
		t.Fatal("restart lost receipt/selection")
	}
	configBytes, _ := os.ReadFile(f.b.settings.Path())
	reconciled := restarted.Apply(modelcatalog.NativeProviderAction{RequestID: "inspect", Action: "local_reconcile", OperationID: record.ID})
	if reconciled.Changed || reconciled.Confirmed || reconciled.LocalReceipt == nil || reconciled.LocalReceipt.Phase != "reconciled" {
		t.Fatal("read-only reconciliation claimed a mutation", reconciled.Error)
	}
	now, _ := os.ReadFile(f.b.settings.Path())
	if string(configBytes) != string(now) || f.mutations.Load() != 0 {
		t.Fatal("unexpected HTTP/settings mutation")
	}
}
func TestNativeLocalSelectionStaleReviewAndFailureBoundaries(t *testing.T) {
	for _, scenario := range []string{"default", "endpoint", "digest", "missing", "generation", "cancel", "expired", "receipt_prewrite", "receipt_finalize", "config_failure", "theme", "revocation"} {
		t.Run(scenario, func(t *testing.T) {
			f := newLocalSelectFixture(t)
			review := f.review(t)
			request := f.selectRequest(review)
			switch scenario {
			case "default":
				f.b.settings.Update(func(s *config.Settings) error { s.Defaults.Model = "newer-cloud"; return nil })
			case "endpoint":
				f.b.settings.Update(func(s *config.Settings) error {
					s.CustomProviders[0].BaseURL = f.server.URL + "/changed/v1/chat/completions"
					return nil
				})
			case "digest":
				f.digest.Store(strings.Repeat("b", 64))
			case "missing":
				f.missing.Store(true)
			case "generation":
				request.Generation = "other-generation"
			case "cancel":
				f.b.Apply(modelcatalog.NativeProviderAction{RequestID: "cancel", Action: "local_cancel_review", ReviewID: review.ID, Generation: review.Generation})
			case "expired":
				f.b.localReview.Expires = time.Now().Add(-time.Second)
			case "receipt_prewrite":
				f.b.writeLocalReceipt = func(*localmodel.SelectionReceiptLease, localmodel.SelectionReceipt) error {
					return fmt.Errorf("inert storage failure")
				}
			case "receipt_finalize":
				f.b.writeLocalReceipt = func(l *localmodel.SelectionReceiptLease, r localmodel.SelectionReceipt) error {
					if r.Phase == "published" {
						return fmt.Errorf("inert finalize failure")
					}
					return l.Write(r)
				}
			case "config_failure":
				var reads atomic.Int32
				f.mu.Lock()
				f.intercept = func(r *http.Request) {
					if r.URL.Path == "/api/tags" {
						if reads.Add(1) == 2 {
							if e := os.Rename(f.b.settings.Path(), f.b.settings.Path()+".fixture-original"); e != nil {
								t.Error(e)
							}
							if e := os.Mkdir(f.b.settings.Path(), 0700); e != nil {
								t.Error(e)
							}
						}
					}
				}
				f.mu.Unlock()
			case "theme":
				f.b.settings.Update(func(s *config.Settings) error { s.Theme = "mono"; return nil })
			case "revocation":
				f.b.settings.Update(func(s *config.Settings) error {
					s.ExternalAgents = nil
					s.ProviderEndpoints = map[string]string{"openai": "https://example.invalid/changed"}
					return nil
				})
			}
			result := f.b.Apply(request)
			wantPublish := scenario == "theme" || scenario == "revocation" || scenario == "receipt_finalize"
			if result.Changed != wantPublish || result.Confirmed != wantPublish {
				t.Fatal("wrong publication outcome", result.Error)
			}
			if !wantPublish && result.Error == "" {
				t.Fatal("unsafe review accepted")
			}
			if scenario == "receipt_finalize" {
				if result.Error == "" || result.LocalReceipt.Phase != "uncertain" {
					t.Fatal("receipt uncertainty hidden")
				}
				r, _ := localmodel.NewSelectionReceipts(f.b.stateDir).Read()
				if r.Phase != "prepared" {
					t.Fatal("prepared intent lost")
				}
			}
			if wantPublish && scenario != "receipt_finalize" {
				s, _ := f.b.settings.Load()
				if scenario == "theme" && s.Theme != "mono" {
					t.Fatal("theme lost")
				}
				if scenario == "revocation" && (len(s.ExternalAgents) != 0 || s.ProviderEndpoints["openai"] != "https://example.invalid/changed") {
					t.Fatal("unrelated update lost")
				}
			}
			if f.mutations.Load() != 0 {
				t.Fatal("selection invoked a model mutation")
			}
		})
	}
}
func TestNativeLocalUnsafeStartDownloadAndUnreviewedSelectRemainRefused(t *testing.T) {
	f := newLocalSelectFixture(t)
	before, _ := f.b.settings.Load()
	for _, action := range []string{"local_start", "local_download", "local_select"} {
		r := f.b.Apply(modelcatalog.NativeProviderAction{RequestID: "blocked", Action: action, ModelID: "qwen3-4b"})
		if r.Changed || r.Confirmed || r.Error == "" {
			t.Fatal("unsafe action accepted", action)
		}
	}
	after, _ := f.b.settings.Load()
	if !reflect.DeepEqual(before, after) || f.requests.Load() != 0 {
		t.Fatal("blocked action made a request or changed settings")
	}
}
func TestNativeLocalSelectionKnownCredentialMetadataCannotLeak(t *testing.T) {
	f := newLocalSelectFixture(t)
	secret := strings.Repeat("c", 64)
	f.digest.Store(secret)
	credentials, _ := auth.New(f.b.stateDir)
	if err := credentials.Put("openai", auth.Credential{Type: "api_key", Key: secret}); err != nil {
		t.Fatal(err)
	}
	result := f.b.Apply(modelcatalog.NativeProviderAction{RequestID: "safe", Action: "local_review_select", ModelID: "qwen3-4b"})
	data, _ := json.Marshal(result)
	if result.LocalReview != nil || strings.Contains(string(data), secret) {
		t.Fatal("credential metadata exposed")
	}
}
func TestNativeLocalMissingOrUnverifiedModelsCannotBeSelected(t *testing.T) {
	for _, mode := range []string{"missing", "invalid_digest", "unreviewed", "unreachable"} {
		t.Run(mode, func(t *testing.T) {
			f := newLocalSelectFixture(t)
			id := "qwen3-4b"
			switch mode {
			case "missing":
				f.missing.Store(true)
			case "invalid_digest":
				f.digest.Store("unknown")
			case "unreviewed":
				id = "unreviewed:latest"
			case "unreachable":
				f.server.Close()
			}
			r := f.b.Apply(modelcatalog.NativeProviderAction{RequestID: "not-ready", Action: "local_review_select", ModelID: id})
			if r.Error == "" || r.LocalReview != nil || f.mutations.Load() != 0 {
				t.Fatal("unverified selection review created")
			}
		})
	}
}
func TestNativeLocalSelectionRevalidationUsesNoInference(t *testing.T) {
	f := newLocalSelectFixture(t)
	review := f.review(t)
	r := f.b.Apply(f.selectRequest(review))
	if !r.Confirmed {
		t.Fatal(r.Error)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m := newLocalModelManager(f.b.settings)
	if _, err := m.Use(ctx, "qwen3-4b"); err == nil {
		t.Fatal("cancelled selection proceeded")
	}
}

func TestNativeLocalSelectionRecentBindingLossFailsClosed(t *testing.T) {
	f := newLocalSelectFixture(t)
	r := f.b.Apply(f.selectRequest(f.review(t)))
	if !r.Confirmed {
		t.Fatal(r.Error)
	}
	t.Setenv("GATOR_STATE_DIR", f.b.stateDir)
	t.Setenv("GATOR_CONFIG_DIR", t.TempDir())
	settings, _ := f.b.settings.Load()
	provider, _ := configuredCustomProvider(settings, "gator-local")
	provider.ModelDigests = nil
	count := f.requests.Load()
	if _, err := newCustomExecutorConfiguration(settings, provider, "qwen3:4b", ""); err == nil || !strings.Contains(err.Error(), "binding is missing") {
		t.Fatal("dropped native binding silently became tag-only", err)
	}
	if f.requests.Load() != count {
		t.Fatal("missing binding attempted inference")
	}
}
func TestNativeLocalSelectionReceiptCannotCrossConfigurationProfiles(t *testing.T) {
	f := newLocalSelectFixture(t)
	r := f.b.Apply(f.selectRequest(f.review(t)))
	if !r.Confirmed {
		t.Fatal(r.Error)
	}
	otherStore, err := config.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	settings, _ := f.b.settings.Load()
	if err := otherStore.Save(settings); err != nil {
		t.Fatal(err)
	}
	other := &nativeProviderBackend{settings: otherStore, stateDir: f.b.stateDir}
	observed := other.Apply(modelcatalog.NativeProviderAction{RequestID: "other-profile", Action: "local_status"})
	if observed.LocalReceipt != nil || observed.Local == nil || observed.Local.SelectionBlock == "" {
		t.Fatal("foreign profile receipt exposed")
	}
	result := other.Apply(modelcatalog.NativeProviderAction{RequestID: "other-review", Action: "local_review_select", ModelID: "qwen3-4b"})
	if result.LocalReview != nil || result.Error == "" {
		t.Fatal("foreign profile authorized selection")
	}
}
