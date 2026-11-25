package personalization

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

func TestMarkdownCandidateCannotBeActivatedByEditingItsText(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	input := memory.ChatInput{Subject: "profile.city", Kind: "fact", Quote: "I plan to visit Singapore.", ConversationID: "work-chat", RunID: "work-first", Context: &memory.Context{Why: "Upcoming trip", Importance: "useful", State: "planned", AppliesTo: []string{"travel"}}}
	snapshot, _ := store.SemanticSnapshot("", nil)
	candidate, err := store.ProposeCandidate(context.Background(), input, memory.SemanticPlan{Relation: memory.Distinct, SuggestedSubject: input.Subject, Snapshot: snapshot, StatementSHA256: markdownHash([]byte(input.Quote))})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.MarkdownDirectory(), "suggestions.md")
	data, _ := os.ReadFile(path)
	os.WriteFile(path, []byte(strings.Replace(string(data), input.Quote, "I live in Singapore.", 1)), 0600)
	if _, err := SyncMarkdown(dir); err == nil {
		t.Fatal("unreviewed candidate edit imported")
	}
	rows, _ := store.List("", true)
	if len(rows) != 0 {
		t.Fatal("candidate became active")
	}
	candidates, _ := store.Candidates()
	if len(candidates) != 1 || candidates[0].ID != candidate.ID || candidates[0].Input.Quote != input.Quote {
		t.Fatal("candidate evidence altered")
	}
}

func TestMarkdownNoteCorrectionInvalidatesDerivedKnowledge(t *testing.T) {
	dir := t.TempDir()
	notes, _ := knowledge.Open(dir)
	source, err := notes.AddNote("Source", "The venue holds 80 people.", "")
	if err != nil {
		t.Fatal(err)
	}
	derived, err := notes.AddNoteWithIDAndDependencies("note-0123456789abcdef01234567", "Summary", "Capacity is 80.", "", nil, []knowledge.Dependency{{Kind: "note", ID: source.ID, Revision: source.SourceRevision()}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "hot-cross-buns", "memory", "categories", "saved-notes.md")
	data, _ := os.ReadFile(path)
	if err := os.WriteFile(path, []byte(strings.Replace(string(data), source.Body, "The venue holds 100 people.", 1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	catalog, err := ReadCatalog(dir, "", "Saved context", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range catalog.Entries {
		if entry.ID == derived.ID && (entry.RecallIssue == "" || strings.Contains(entry.Text, "Capacity is 80")) {
			t.Fatal("stale derived content remains available")
		}
	}
}

func TestMarkdownCategoriesImportCorrectionsAndPreserveIdentity(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	record, err := store.RememberChat(memory.ChatInput{Subject: "profile.projects", Kind: "fact", Quote: "im working on five projects", ConversationID: "work-chat", RunID: "work-run"})
	if err != nil {
		t.Fatal(err)
	}
	files, err := SyncMarkdown(dir)
	if err != nil || len(files) != 8 {
		t.Fatalf("files %v %v", files, err)
	}
	path := filepath.Join(store.MarkdownDirectory(), "projects.md")
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), record.Text) {
		t.Fatal("project not exported", err)
	}
	for _, file := range files {
		if err := privatefs.Check(file.Path); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(path, []byte(strings.Replace(string(data), record.Text, "im working on six projects", 1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	current, _ := store.Load(record.ID)
	if current.Text != "im working on six projects" || current.ID != record.ID || current.Subject != "profile.projects" || current.Origin.Basis != "user-corrected" {
		t.Fatalf("correction %#v", current)
	}
	catalog, err := ReadCatalog(dir, "", "Projects and goals", 0)
	if err != nil || len(catalog.Entries) != 1 || len(catalog.MarkdownFiles) != 8 {
		t.Fatalf("catalog %#v %v", catalog, err)
	}
	// A later HCB edit is exported rather than replaced by the last Markdown snapshot.
	if _, err := store.Correct(record.ID, "im working on seven projects", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(path)
	if !strings.Contains(string(data), "seven projects") {
		t.Fatal("HCB update did not reach Markdown")
	}
}

func TestMarkdownConflictAndRemovedMarkerDoNotOverwriteNewerMemory(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	record, _ := store.Add("preference", "Prefer concise replies", "", "", time.Time{})
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.MarkdownDirectory(), "preferences.md")
	data, _ := os.ReadFile(path)
	edited := []byte(strings.Replace(string(data), record.Text, "Prefer detailed replies", 1))
	if err := os.WriteFile(path, edited, 0600); err != nil {
		t.Fatal(err)
	}
	store.Correct(record.ID, "Prefer balanced replies", "")
	if _, err := SyncMarkdown(dir); err == nil {
		t.Fatal("concurrent source edit was overwritten")
	}
	current, _ := store.Load(record.ID)
	if current.Text != "Prefer balanced replies" {
		t.Fatal("newer record overwritten")
	}
	remaining, _ := os.ReadFile(path)
	if string(remaining) != string(edited) {
		t.Fatal("conflicted local edit lost")
	}
	if err := os.WriteFile(path, []byte("# Preferences\nI deleted everything."), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err == nil {
		t.Fatal("missing marker accepted as deletion")
	}
}

func TestMarkdownRefusesLinkedFilesAndRecoversInterruptedExport(t *testing.T) {
	dir := t.TempDir()
	store, _ := memory.Open(dir)
	store.Add("preference", "Prefer concise replies", "", "", time.Time{})
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal(err)
	}
	root := store.MarkdownDirectory()
	path := filepath.Join(root, "preferences.md")
	index, _ := os.ReadFile(filepath.Join(root, ".preferences.md.json"))
	// This is the state after publishing the Markdown but before finalizing its index.
	if err := os.WriteFile(filepath.Join(root, ".pending-preferences.md.json"), index, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, ".preferences.md.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err != nil {
		t.Fatal("interrupted export did not recover", err)
	}
	target := filepath.Join(t.TempDir(), "private.txt")
	os.WriteFile(target, []byte("untouched"), 0600)
	os.Remove(path)
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncMarkdown(dir); err == nil {
		t.Fatal("linked category file was accepted")
	}
	data, _ := os.ReadFile(target)
	if string(data) != "untouched" {
		t.Fatal("symlink target changed")
	}
}
