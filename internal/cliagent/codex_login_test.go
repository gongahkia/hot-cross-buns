package cliagent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalCodexLoginDoesNotUseManagerKeyOrImportConfig(t *testing.T) {
	home := t.TempDir()
	login := `{"auth_mode":"chatgpt","tokens":{"access_token":"synthetic-local-access","refresh_token":"synthetic-refresh"}}`
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(login), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("private unrelated config"), 0600); err != nil {
		t.Fatal(err)
	}
	r := fixtureRequest(t, "")
	r.Config.AuthMode = "codex_login"
	r.Config.CodexHome = home
	r.Config.APIKeyEnv = ""
	t.Setenv("OPENAI_API_KEY", "manager-only-key")
	if err := r.Config.Validate(); err != nil {
		t.Fatal(err)
	}
	token, err := r.Config.credential()
	if err != nil || token != "synthetic-local-access" {
		t.Fatal("CLI login was not selected")
	}
	prepared, err := prepareCLI(context.Background(), r.Config, r.Source, "", []string{}, false, nil, token)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Cleanup()
	var privateHome string
	for _, value := range prepared.Command.Env {
		if strings.HasPrefix(value, "CODEX_HOME=") {
			privateHome = strings.TrimPrefix(value, "CODEX_HOME=")
		}
		if strings.Contains(value, "manager-only-key") || strings.HasPrefix(value, "CODEX_API_KEY=") || strings.HasPrefix(value, "OPENAI_API_KEY=") {
			t.Fatal("API key leaked into local CLI login")
		}
	}
	if privateHome == "" || privateHome == home {
		t.Fatal("CLI must use a private Codex home")
	}
	copied, err := os.ReadFile(filepath.Join(privateHome, "auth.json"))
	if err != nil || string(copied) != login {
		t.Fatal("private login copy missing")
	}
	if _, err := os.Stat(filepath.Join(privateHome, "config.toml")); !os.IsNotExist(err) {
		t.Fatal("imported unrelated CLI configuration")
	}
	prepared.Cleanup()
	if _, err := os.Stat(filepath.Join(privateHome, "auth.json")); !os.IsNotExist(err) {
		t.Fatal("credential copy survived CLI cleanup")
	}
	original, err := os.ReadFile(filepath.Join(home, "auth.json"))
	if err != nil || string(original) != login {
		t.Fatal("original login changed")
	}
	for _, change := range []func(*Config){func(c *Config) { c.BaseURL = "https://example.com" }, func(c *Config) { c.APIKeyEnv = "OPENAI_API_KEY" }, func(c *Config) { c.Kind = "pi" }} {
		cfg := r.Config
		change(&cfg)
		if cfg.Validate() == nil {
			t.Fatal("invalid login configuration accepted")
		}
	}
	private := t.TempDir()
	if err := os.Symlink(home, filepath.Join(private, "codex")); err == nil {
		if cleanup, err := r.Config.stageCodexLogin(private); err == nil {
			cleanup()
			t.Fatal("linked private credential directory accepted")
		}
		original, _ := os.ReadFile(filepath.Join(home, "auth.json"))
		if string(original) != login {
			t.Fatal("original credential altered through a symlink")
		}
	}
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(`{"auth_mode":"apikey","OPENAI_API_KEY":"other"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Config.credential(); err == nil {
		t.Fatal("non-ChatGPT login accepted")
	}
}
