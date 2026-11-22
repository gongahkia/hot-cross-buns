package personalization

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/learning"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

func TestCatalogPagesAllPersonalRecordsAndPreservesStatusAndScope(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	for i := 0; i < 45; i++ {
		if _, err := store.Add("preference", fmt.Sprintf("Preference %d", i), "", "user", time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Add("fact", "Goal-specific fact", "goal-"+strings.Repeat("a", 24), "user", time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add("fact", "Expired fact", "", "user", time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	notes, _ := knowledge.Open(dir)
	if _, err := notes.AddNote("Working context", "A saved note", ""); err != nil {
		t.Fatal(err)
	}
	lessons, _ := learning.Open(dir)
	if _, err := lessons.Create(learning.Create{Type: learning.Procedure, Key: "review", Content: "A proposed workflow", Origin: learning.Inferred, Scope: learning.Scope{Kind: learning.Global}, Confidence: 50}); err != nil {
		t.Fatal(err)
	}
	first, err := ReadCatalog(dir, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ReadCatalog(dir, "", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 49 || first.Pages != 2 || len(first.Entries) != 40 || len(second.Entries) != 9 {
		t.Fatalf("incomplete catalog: %+v / %+v", first, second)
	}
	found := map[string]bool{}
	for _, entry := range append(first.Entries, second.Entries...) {
		if found[entry.ID] {
			t.Fatal("duplicated topic")
		}
		found[entry.ID] = true
		if entry.Text == "Goal-specific fact" && (entry.Category != "Projects and goals" || entry.Editable) {
			t.Fatal("goal context missing its scope boundary")
		}
		if entry.Text == "Expired fact" && entry.Status != "Needs review" {
			t.Fatal("expired memory shown as active")
		}
		if entry.Text == "A proposed workflow" && entry.Status != "Awaiting review" {
			t.Fatal("unconfirmed guidance shown as active")
		}
	}
	filtered, err := ReadCatalog(dir, "Preference 44", "Preferences", 0)
	if err != nil || filtered.Matched != 1 {
		t.Fatalf("filter: %+v %v", filtered, err)
	}
}
func TestCatalogCorrectionsAndForgettingUseReviewedRevisions(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	record, err := store.Add("preference", "Original wording", "", "user", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	action := CatalogAction{Action: "correct", ID: record.ID, Revision: record.UpdatedAt.Format(time.RFC3339Nano), Text: "Corrected wording"}
	changed := ApplyCatalog(dir, action)
	if changed.Error != "" {
		t.Fatal(changed.Error)
	}
	if retried := ApplyCatalog(dir, action); retried.Error == "" {
		t.Fatal("stale correction accepted")
	}
	if stale := ApplyCatalog(dir, CatalogAction{Action: "forget", ID: record.ID, Revision: action.Revision}); stale.Error == "" {
		t.Fatal("stale forgetting accepted")
	}
	current, err := store.Load(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	forgotten := ApplyCatalog(dir, CatalogAction{Action: "forget", ID: record.ID, Revision: current.UpdatedAt.Format(time.RFC3339Nano)})
	if forgotten.Error != "" || forgotten.Catalog.Total != 0 {
		t.Fatalf("forget: %+v", forgotten)
	}
}

func TestCatalogAddsExplicitPersonalMemoryWithTypeIcons(t *testing.T) {
	dir := t.TempDir()
	for _, kind := range []string{"fact", "preference", "note"} {
		result := ApplyCatalog(dir, CatalogAction{RequestID: "add-" + kind, Action: "add", MemoryKind: kind, Text: "A user supplied " + kind})
		if result.Error != "" {
			t.Fatal(result.Error)
		}
	}
	catalog, err := ReadCatalog(dir, "", "", 0)
	if err != nil || catalog.Total != 3 {
		t.Fatalf("catalog: %+v %v", catalog, err)
	}
	for _, item := range catalog.Entries {
		if item.Icon == "" || !item.Editable || item.Scope != "Across chats" || item.Source != "Added by you" {
			t.Fatalf("invalid personal item: %+v", item)
		}
	}
	for _, action := range []CatalogAction{
		{Action: "add", MemoryKind: "guidance", Text: "Unreviewed instruction"},
		{Action: "add", MemoryKind: "fact", Text: ""},
		{Action: "add", MemoryKind: "fact", Text: "New fact", ID: "mem-existing"},
	} {
		if result := ApplyCatalog(dir, action); result.Error == "" {
			t.Fatalf("invalid add accepted: %+v", action)
		}
	}
}
