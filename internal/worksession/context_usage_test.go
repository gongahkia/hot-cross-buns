package worksession

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

func TestContextMeasurementPersistsOnlyBoundedMetadataAndRejectsLinkedFiles(t *testing.T) {
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	v := agent.ContextUsage{Policy: agent.ContextPolicy{Provider: "fixture", Model: "small", Window: 8192, OutputReserve: 1024}, InputTokens: 1000, InputLimit: 6656, OutputReserve: 1024, At: time.Now()}
	if err := s.SaveContextUsage(chat.ID, v); err != nil {
		t.Fatal(err)
	}
	saved, err := s.ReadContextUsage(chat.ID)
	if err != nil || saved.InputTokens != 1000 {
		t.Fatal(saved, err)
	}
	path := filepath.Join(s.root, chat.ID, "context-meter.json")
	data, _ := os.ReadFile(path)
	if len(data) > 8192 || strings.Contains(string(data), "messages") {
		t.Fatal("request content entered telemetry")
	}
	external := filepath.Join(t.TempDir(), "target")
	os.WriteFile(external, []byte("untouched"), 0600)
	os.Remove(path)
	os.Symlink(external, path)
	if err := s.SaveContextUsage(chat.ID, v); err == nil {
		t.Fatal("linked measurement accepted")
	}
	if data, _ := os.ReadFile(external); string(data) != "untouched" {
		t.Fatal("external file changed")
	}
}
