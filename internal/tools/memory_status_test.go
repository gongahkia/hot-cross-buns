package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

func TestMemoryStatusExplainsChangedSourcesWithoutRecallingTheirText(t *testing.T) {
	state := t.TempDir()
	store, _ := memory.Open(state)
	file := filepath.Join(t.TempDir(), "profile.txt")
	os.WriteFile(file, []byte("Earlier address"), 0600)
	linked, err := store.AddFromFile("fact", "Earlier private address", "", file, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	other, _ := store.Add("fact", "Unrelated goal secret", "goal-aaaaaaaaaaaaaaaaaaaaaaaa", "user", time.Time{})
	os.WriteFile(file, []byte("Corrected address"), 0600)
	status := memoryStatus{PersonalKnowledge: PersonalKnowledge{Memories: store}}
	value, err := status.Execute(context.Background(), []byte(`{}`))
	if err != nil || !strings.Contains(value.Content, linked.ID) || !strings.Contains(value.Content, "source_needs_review") {
		t.Fatal(value, err)
	}
	for _, forbidden := range []string{"Earlier private address", "Unrelated goal secret", other.ID} {
		if strings.Contains(value.Content, forbidden) {
			t.Fatal("unavailable or foreign memory content leaked", forbidden)
		}
	}
	status.ExcludedIDs = []string{linked.ID}
	value, err = status.Execute(context.Background(), []byte(`{}`))
	if err != nil || strings.Contains(value.Content, linked.ID) {
		t.Fatal("excluded item was exposed", value, err)
	}
	if _, err = status.Execute(context.Background(), []byte(`{"confirm":true}`)); err == nil {
		t.Fatal("read-only status accepted mutation arguments")
	}
}
