package cliagent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
)

// Opt-in acceptance uses the existing local Codex login, never the manager key.
func TestLiveCodexFilesystemGrant(t *testing.T) {
	report := os.Getenv("HCB_LIVE_CODEX_FILES_REPORT")
	if report == "" {
		t.Skip("opt-in local Codex live filesystem acceptance")
	}
	if _, err := os.Stat(report); !os.IsNotExist(err) {
		t.Fatal("report must be a new file")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(home, ".config", "hot-cross-buns", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Agents []json.RawMessage `json:"external_agents"`
	}
	if err = json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	found := false
	for _, raw := range settings.Agents {
		var value struct {
			Kind string `json:"kind"`
			Auth string `json:"auth_mode"`
		}
		if json.Unmarshal(raw, &value) == nil && value.Kind == "codex" && value.Auth == "codex_login" {
			if err = json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("local Codex login is not configured; no API-key fallback")
	}
	canonical := func(p string) string {
		v, err := filepath.EvalSymlinks(p)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	state, source, folder := canonical(t.TempDir()), canonical(t.TempDir()), canonical(t.TempDir())
	scratch := filepath.Join(state, "scratch")
	os.Mkdir(scratch, 0700)
	note, created, deleted := filepath.Join(folder, "note.txt"), filepath.Join(folder, "created.txt"), filepath.Join(folder, "delete-me.txt")
	os.WriteFile(note, []byte("old fixture"), 0600)
	os.WriteFile(deleted, []byte("disposable fixture"), 0600)
	store, _ := fileaccess.Open(state)
	access, _ := fileaccess.NewTask(store, false, func(context.Context, fileaccess.Review) (string, error) { return "once", nil })
	if _, err := access.Access(context.Background(), folder, "write", "request_access", "synthetic Codex acceptance"); err != nil {
		t.Fatal(err)
	}
	envelope, err := access.Envelope()
	if err != nil {
		t.Fatal(err)
	}
	cfg.LiveFiles = &sandbox.LiveFilesystem{Read: envelope.Read, Write: envelope.Write, Protected: envelope.Protected, Full: envelope.Full, Fingerprint: envelope.Digest}
	cfg.TimeoutSeconds = 120
	targets, _ := json.Marshal(map[string]string{"read_then_replace": note, "create": created, "delete": deleted})
	task := "This is a disposable live-filesystem acceptance test. Host-approved live directory: " + folder + ". Read the file at read_then_replace, then replace its entire contents with exactly live filesystem verified (no trailing newline). Create the file at create with exactly created through Codex (no trailing newline). Delete only the disposable file at delete. Read back the two remaining files and check the deleted path is absent. Do not modify the private checkout or any other files. Do not use network or spawn other agents. Return a concise result. Paths: " + string(targets)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	result, runErr := RunSession(ctx, SessionRequest{Request: Request{Config: cfg, Source: source, Scratch: scratch, ID: "live-files", Task: task}, Store: filepath.Join(state, "hot-cross-buns", "cli-sessions"), Owner: "live-files-acceptance", Capture: "synthetic-empty-source"})
	actual, _ := os.ReadFile(note)
	newFile, _ := os.ReadFile(created)
	_, deletedErr := os.Stat(deleted)
	checks := map[string]bool{"worker_succeeded": runErr == nil, "updated_live_file": string(actual) == "live filesystem verified", "created_live_file": string(newFile) == "created through Codex", "deleted_disposable_file": os.IsNotExist(deletedErr), "private_checkout_unchanged": len(result.Patch) == 0}
	output := struct {
		At     time.Time       `json:"at"`
		Checks map[string]bool `json:"checks"`
		Error  string          `json:"error,omitempty"`
	}{At: time.Now(), Checks: checks}
	if runErr != nil {
		output.Error = runErr.Error()
	}
	encoded, _ := json.MarshalIndent(output, "", "  ")
	if err := os.WriteFile(report, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	for name, passed := range checks {
		if !passed {
			t.Errorf("%s failed; run error: %v", name, runErr)
		}
	}
}
