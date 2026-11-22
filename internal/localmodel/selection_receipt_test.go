package localmodel

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/gator/internal/agent"
)

func fixtureSelectionReceipt() SelectionReceipt {
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	return SelectionReceipt{Version: 1, ID: "operation", RequestID: "request", ProfileID: "profile", Generation: "generation", Endpoint: "http://127.0.0.1:11434", ModelID: "qwen3-4b", Tag: "qwen3:4b", Digest: strings.Repeat("a", 64), SettingsRevision: strings.Repeat("b", 64), Phase: "prepared", CreatedAt: stamp, UpdatedAt: stamp}
}
func TestSelectionReceiptsPrivateBoundedAndCrashIntent(t *testing.T) {
	s := NewSelectionReceipts(t.TempDir())
	if r, err := s.Read(); err != nil || r != nil {
		t.Fatal("missing receipt", err)
	}
	lease, err := s.Lock()
	if err != nil {
		t.Fatal(err)
	}
	r := fixtureSelectionReceipt()
	if err := lease.Write(r); err != nil {
		t.Fatal(err)
	}
	lease.Close()
	read, err := s.Read()
	if err != nil || read.Phase != "prepared" || read.ID != r.ID {
		t.Fatal("restart lost prepared intent", err)
	}
	for _, name := range []string{"selection.json", ".operation.lock"} {
		info, err := os.Stat(filepath.Join(s.Directory, name))
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("not private", err)
		}
	}
	for _, data := range []string{`{"version":2}`, strings.Repeat("x", 16*1024+1)} {
		if err := os.WriteFile(filepath.Join(s.Directory, "selection.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Read(); err == nil {
			t.Fatal("future/malformed receipt accepted")
		}
	}
}
func TestSelectionReceiptLockIndependentProcessAndNoSymlink(t *testing.T) {
	root := t.TempDir()
	s := NewSelectionReceipts(root)
	lease, err := s.Lock()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestSelectionReceiptLockHelper$")
	child.Env = []string{"PATH=" + os.Getenv("PATH"), "GATOR_SELECTION_ROOT=" + root}
	if out, err := child.CombinedOutput(); err != nil {
		lease.Close()
		t.Fatal("cross-process exclusion", err, string(out))
	}
	lease.Close()
	if another, err := s.Lock(); err != nil {
		t.Fatal("lock not released", err)
	} else {
		another.Close()
	}
	outside := filepath.Join(t.TempDir(), "untouched")
	os.WriteFile(outside, []byte("inert"), 0600)
	if err := os.Symlink(outside, filepath.Join(s.Directory, "selection.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Read(); err == nil {
		t.Fatal("receipt symlink accepted")
	}
	if data, _ := os.ReadFile(outside); string(data) != "inert" {
		t.Fatal("outside file changed")
	}
}
func TestSelectionReceiptLockHelper(t *testing.T) {
	root := os.Getenv("GATOR_SELECTION_ROOT")
	if root == "" {
		t.Skip("child helper")
	}
	if lease, err := NewSelectionReceipts(root).Lock(); err == nil {
		lease.Close()
		t.Fatal("concurrent operation admitted")
	}
}
func TestDigestCheckedModelRejectsMissingAndChangedWithoutInference(t *testing.T) {
	for _, mode := range []string{"same", "changed", "missing", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			backend := &scriptedModel{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/tags" || r.Method != "GET" {
					t.Error("unexpected request")
				}
				switch mode {
				case "same":
					fmt.Fprintf(w, `{"models":[{"name":"qwen3:4b","digest":"%s"}]}`, strings.Repeat("a", 64))
				case "changed":
					fmt.Fprintf(w, `{"models":[{"name":"qwen3:4b","digest":"%s"}]}`, strings.Repeat("c", 64))
				case "missing":
					fmt.Fprint(w, `{"models":[]}`)
				default:
					w.WriteHeader(503)
				}
			}))
			defer server.Close()
			client, _ := NewClient(server.URL)
			model := DigestCheckedModel{Backend: backend, Client: client, Tag: "qwen3:4b", Digest: strings.Repeat("a", 64)}
			_, err := model.Complete(context.Background(), agent.TurnRequest{})
			if mode == "same" {
				if err != nil || backend.calls != 1 {
					t.Fatal(err)
				}
			} else if err == nil || backend.calls != 0 {
				t.Fatal("changed/missing artifact inferred", err)
			}
		})
	}
}
