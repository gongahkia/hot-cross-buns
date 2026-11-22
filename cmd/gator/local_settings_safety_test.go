package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/gator/internal/cliagent"
	"github.com/gongahkia/gator/internal/config"
)

func TestLocalSelectionIndependentWriters(t *testing.T) {
	for _, action := range []string{"default", "cloud", "revoke", "competing", "theme", "endpoint", "write_failure"} {
		t.Run(action, func(t *testing.T) {
			dir := t.TempDir()
			store, err := config.New(dir)
			if err != nil {
				t.Fatal(err)
			}
			initial := config.Default()
			initial.ExternalAgents = []cliagent.Config{{Kind: "codex", Executable: "/fixture/never-executed", APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10}}
			if err := store.Save(initial); err != nil {
				t.Fatal(err)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("unexpected mutation")
				}
				if r.URL.Path == "/api/version" {
					fmt.Fprint(w, `{"version":"fixture"}`)
					return
				}
				if calls.Add(1) == 1 {
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
					}
				}
				fmt.Fprint(w, `{"models":[{"name":"qwen3:4b","size":2500000000,"digest":"sha256:four"},{"name":"qwen3:8b","size":5200000000,"digest":"sha256:eight"}]}`)
			}))
			defer server.Close()
			m := newLocalModelManager(store)
			m.host = localFirstAuditHost
			m.runtimeURL = server.URL
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := m.Use(ctx, "qwen3-4b"); done <- err }()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("barrier", ctx.Err())
			}
			child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLocalSelectionIndependentWriterHelper$")
			child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "GATOR_L2A_CONFIG=" + dir, "GATOR_L2A_ACTION=" + action, "GATOR_L2A_ENDPOINT=" + server.URL}
			out, err := child.CombinedOutput()
			close(release)
			if err != nil {
				t.Fatal("independent writer", err, string(out))
			}
			useErr := <-done
			conflict := action == "default" || action == "competing" || action == "endpoint" || action == "write_failure"
			if (useErr != nil) != conflict {
				t.Fatalf("action %s: selection error %v", action, useErr)
			}
			if action == "write_failure" {
				return
			}
			after, err := store.Load()
			if err != nil {
				t.Fatal(err)
			}
			switch action {
			case "default":
				if after.Defaults.Provider != "openai" || after.Defaults.Model != "reviewed-new" {
					t.Fatal("default overwritten")
				}
			case "cloud":
				if after.ProviderEndpoints["openai"] != "https://example.invalid/v1" {
					t.Fatal("cloud edit lost")
				}
			case "revoke":
				if len(after.ExternalAgents) != 0 {
					t.Fatal("CLI revocation restored")
				}
			case "competing":
				if after.Defaults.Model != "qwen3:8b" {
					t.Fatal("competing selection overwritten")
				}
			case "theme":
				if after.Theme != "mono" {
					t.Fatal("theme overwritten")
				}
			case "endpoint":
				p, _ := configuredCustomProvider(after, "gator-local")
				if !strings.HasSuffix(p.BaseURL, "/changed/v1/chat/completions") {
					t.Fatal("endpoint overwritten")
				}
			}
		})
	}
}
func TestLocalSelectionIndependentWriterHelper(t *testing.T) {
	dir := os.Getenv("GATOR_L2A_CONFIG")
	if dir == "" {
		t.Skip("independent helper")
	}
	store, err := config.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	action := os.Getenv("GATOR_L2A_ACTION")
	if action == "competing" {
		m := newLocalModelManager(store)
		m.host = localFirstAuditHost
		m.runtimeURL = os.Getenv("GATOR_L2A_ENDPOINT")
		if _, err := m.Use(context.Background(), "qwen3-8b"); err != nil {
			t.Fatal(err)
		}
		return
	}
	if action == "write_failure" {
		if err := os.Rename(store.Path(), store.Path()+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(store.Path(), 0700); err != nil {
			t.Fatal(err)
		}
		return
	}
	if err := store.Update(func(s *config.Settings) error {
		switch action {
		case "default":
			s.Defaults = config.Defaults{Provider: "openai", Model: "reviewed-new"}
		case "cloud":
			s.ProviderEndpoints = map[string]string{"openai": "https://example.invalid/v1"}
		case "revoke":
			s.ExternalAgents = nil
		case "theme":
			s.Theme = "mono"
		case "endpoint":
			s.CustomProviders = []config.CustomProvider{{ID: "gator-local", BaseURL: os.Getenv("GATOR_L2A_ENDPOINT") + "/changed/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestLocalSelectionRejectsChangedInstalledDigest(t *testing.T) {
	store, _ := config.New(t.TempDir())
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"models":[{"name":"qwen3:4b","digest":"sha256:%d","size":1}]}`, reads.Add(1))
	}))
	defer server.Close()
	m := newLocalModelManager(store)
	m.host = localFirstAuditHost
	m.runtimeURL = server.URL
	before, _ := store.Load()
	_, err := m.Use(context.Background(), "qwen3-4b")
	after, _ := store.Load()
	if err == nil || !strings.Contains(err.Error(), "identity changed") || !reflect.DeepEqual(before, after) {
		t.Fatal("stale digest committed", err)
	}
}
