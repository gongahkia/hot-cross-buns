package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/gongahkia/gator/internal/cliagent"
	"github.com/gongahkia/gator/internal/config"
	"github.com/gongahkia/gator/internal/modelcatalog"
)

func TestNativeLocalSelectionIndependentRevocationDuringHTTP(t *testing.T) {
	f := newLocalSelectFixture(t)
	if err := f.b.settings.Update(func(s *config.Settings) error {
		s.ExternalAgents = []cliagent.Config{{Kind: "codex", Executable: "/fixture/never-executed", APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	review := f.review(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.mu.Lock()
	f.intercept = func(r *http.Request) {
		if r.URL.Path == "/api/tags" {
			once.Do(func() {
				close(entered)
				select {
				case <-release:
				case <-r.Context().Done():
				}
			})
		}
	}
	f.mu.Unlock()
	done := make(chan modelcatalog.NativeProviderResult, 1)
	go func() { done <- f.b.Apply(f.selectRequest(review)) }()
	<-entered
	child := exec.Command(os.Args[0], "-test.run=^TestLocalSelectionIndependentWriterHelper$")
	child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + t.TempDir(), "GATOR_L2A_CONFIG=" + filepath.Dir(filepath.Dir(f.b.settings.Path())), "GATOR_L2A_ACTION=revoke"}
	output, err := child.CombinedOutput()
	close(release)
	if err != nil {
		t.Fatal(err, string(output))
	}
	result := <-done
	if !result.Confirmed {
		t.Fatal(result.Error)
	}
	loaded, err := f.b.settings.Load()
	if err != nil || len(loaded.ExternalAgents) != 0 {
		t.Fatal("native selection restored revoked CLI configuration", err)
	}
}
