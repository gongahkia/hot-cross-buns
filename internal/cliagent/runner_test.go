package cliagent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/patch"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
)

func fixtureRequest(t *testing.T, body string) Request {
	t.Helper()
	if _, err := sandbox.StrictAvailability(); err != nil {
		t.Skip(err)
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	scratch := filepath.Join(root, "scratch")
	for _, dir := range []string{source, scratch} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "note.txt"), []byte("original\n"), 0600); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(root, "fake-cli")
	script := "#!/bin/sh\nset -eu\ncat >/dev/null\n" + body + "\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"done\"}}' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":2}}'\n"
	if err := os.WriteFile(executable, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FIXTURE_API_KEY", "synthetic-private-key-value")
	return Request{Config: Config{Kind: "codex", Executable: executable, APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10, AllowEdits: true}, Source: source, Scratch: scratch, ID: "task-1", Task: "inspect fixture"}
}
func TestRunnerIsolatesEditsAndTrustedGit(t *testing.T) {
	r := fixtureRequest(t, `printf 'updated\n' > note.txt
mkdir .git
printf 'malicious metadata\n' > .git/config`)
	r.Edit = true
	value, err := Run(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(value.Patch), "+updated") || value.Summary != "done" {
		t.Fatalf("unexpected result: %+v", value)
	}
	original, err := os.ReadFile(filepath.Join(r.Source, "note.txt"))
	if err != nil || string(original) != "original\n" {
		t.Fatalf("original modified: %q %v", original, err)
	}
	target := filepath.Join(r.Scratch, "apply-check")
	if err := patch.InitSnapshot(context.Background(), r.Source, target); err != nil {
		t.Fatal(err)
	}
	if err := patch.ApplySnapshot(context.Background(), target, value.Patch); err != nil {
		t.Fatalf("patch cannot be applied: %v", err)
	}
}
func TestRunnerEnforcesReadOnlyAndPathEnvelope(t *testing.T) {
	for _, edit := range []bool{false, true} {
		t.Run(map[bool]string{false: "inspect", true: "scoped"}[edit], func(t *testing.T) {
			r := fixtureRequest(t, `if printf 'forbidden\n' > note.txt 2>/dev/null; then exit 9; fi`)
			r.Edit = edit
			if edit {
				r.Scopes = []string{"allowed"}
			}
			if _, err := Run(context.Background(), r); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestRunnerCanInspectSelectedBaseline(t *testing.T) {
	r := fixtureRequest(t, `test "$(cat note.txt)" = updated`)
	r.Baseline = []byte("diff --git a/note.txt b/note.txt\n--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-original\n+updated\n")
	value, err := Run(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if len(value.Patch) != 0 {
		t.Fatal("read-only baseline returned as new edits")
	}
}
func TestRunnerCancellationStopsProcess(t *testing.T) {
	r := fixtureRequest(t, `sleep 30 &
wait`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var start time.Time
	r.OnEvent = func(event agent.Event) {
		if strings.Contains(event.Text, "started") {
			start = time.Now()
			time.AfterFunc(250*time.Millisecond, cancel)
		}
	}
	_, err := Run(ctx, r)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("cancellation waited for descendants")
	}
}
func TestRunnerRejectsFailedAndSecretResults(t *testing.T) {
	for _, body := range []string{`printf '%s\n' '{"type":"turn.failed"}'`, `printf '%s' "$CODEX_API_KEY" > secret.txt`} {
		r := fixtureRequest(t, body)
		r.Edit = true
		value, err := Run(context.Background(), r)
		if err == nil {
			t.Fatal("accepted failed or secret-bearing output")
		}
		if len(value.Patch) > 0 {
			t.Fatal("retained rejected patch")
		}
		if _, err := os.Stat(filepath.Join(r.Scratch, r.ID+"-cli")); !os.IsNotExist(err) {
			t.Fatal("private working files not cleaned up")
		}
	}
}

func TestAppCredentialIsTransientAndRedacted(t *testing.T) {
	r := fixtureRequest(t, `printf '%s' "$CODEX_API_KEY" > note.txt`)
	r.Edit = true
	r.Config.Credential = func() (string, error) { return "app-store-only-secret", nil }
	encoded, err := json.Marshal(r.Config)
	if err != nil || strings.Contains(string(encoded), "app-store-only-secret") {
		t.Fatal("credential persisted in configuration")
	}
	_, err = Run(context.Background(), r)
	if err == nil || strings.Contains(err.Error(), "app-store-only-secret") {
		t.Fatal("credential patch was not rejected/redacted")
	}
}

func TestHeadlessAdaptersKeepOuterSandboxAndPrivateSettings(t *testing.T) {
	for _, kind := range []string{"opencode", "gemini", "copilot"} {
		t.Run(kind, func(t *testing.T) {
			r := fixtureRequest(t, "")
			script := `#!/bin/sh
set -eu
cat >/dev/null
if printf bad > note.txt 2>/dev/null; then exit 9; fi
`
			terminal := ""
			switch kind {
			case "opencode":
				script += `test "$OPENCODE_DISABLE_PROJECT_CONFIG" = true
test "$OPENAI_API_KEY" = synthetic-private-key-value
`
				terminal = `{"type":"text","part":{"text":"done"}}` + "\n" + `{"type":"step_finish","part":{"reason":"stop"}}`
			case "gemini":
				script += `test -f "$GEMINI_CLI_SYSTEM_SETTINGS_PATH"
test "$GEMINI_API_KEY" = synthetic-private-key-value
`
				terminal = `{"type":"message","role":"assistant","content":"done"}` + "\n" + `{"type":"result","status":"success"}`
			case "copilot":
				script += `test "$COPILOT_PROVIDER_WIRE_API" = responses
test "$COPILOT_PROVIDER_API_KEY" = synthetic-private-key-value
test "$COPILOT_PLUGIN_DIR_ONLY" = true
test "$(cat "$COPILOT_HOME/settings.json")" = '{"disableAllHooks":true}'
`
				terminal = `{"type":"assistant.message","data":{"content":"done"}}` + "\n" + `{"type":"result","exitCode":0}`
			}
			script += "cat <<'RESULT'\n" + terminal + "\nRESULT\n"
			if err := os.WriteFile(r.Config.Executable, []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			r.Config.Kind = kind
			value, err := Run(context.Background(), r)
			if err != nil || value.Summary != "done" {
				t.Fatalf("sandboxed %s: %+v %v", kind, value, err)
			}
		})
	}
}
