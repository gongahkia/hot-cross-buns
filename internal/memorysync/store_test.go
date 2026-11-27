package memorysync

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

func temporary(t *testing.T) string {
	t.Helper()
	path, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func run(t *testing.T, s Store) Report {
	t.Helper()
	r, err := s.Run(context.Background(), "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Issues) > 0 {
		t.Fatal(r.Issues)
	}
	return r
}
func TestTwoDeviceMemoryNotesCorrectionForgetAndRestart(t *testing.T) {
	shared := temporary(t)
	a := Store{StateDir: temporary(t), Folder: shared}
	b := Store{StateDir: temporary(t), Folder: shared}
	ma, _ := memory.Open(a.StateDir)
	mb, _ := memory.Open(b.StateDir)
	first, err := ma.RememberChat(memory.ChatInput{Subject: "preference.tone", Kind: "preference", Quote: "I prefer casual replies.", ConversationID: "work-original", RunID: "run-original"})
	if err != nil {
		t.Fatal(err)
	}
	notes, _ := knowledge.Open(a.StateDir)
	note, err := notes.AddNote("Project context", "A bakery assistant.", "")
	if err != nil {
		t.Fatal(err)
	}
	run(t, a)
	run(t, b)
	copied, err := mb.Load(first.ID)
	if err != nil || copied.Text != first.Text || copied.Origin.ConversationID != "work-original" {
		t.Fatal(copied, err)
	}
	nb, _ := knowledge.Open(b.StateDir)
	copiedNote, err := nb.LoadNote(note.ID)
	if err != nil || copiedNote.Body != note.Body || copiedNote.ID != note.ID {
		t.Fatal(copiedNote, err)
	}
	if _, err = mb.Correct(first.ID, "I prefer concise casual replies.", ""); err != nil {
		t.Fatal(err)
	}
	run(t, b)
	run(t, a)
	latest, err := ma.Load(first.ID)
	if err != nil || latest.Text != "I prefer concise casual replies." {
		t.Fatal(latest, err)
	}
	if err = ma.Forget(first.ID); err != nil {
		t.Fatal(err)
	}
	run(t, a)
	run(t, b)
	if _, err = mb.Load(first.ID); !os.IsNotExist(err) {
		t.Fatal("forgotten memory survived sync", err)
	}
	blocked, err := mb.HistorySuppressed("work-original", "")
	if err != nil || !blocked {
		t.Fatal("forgetting lost its history exclusion", err)
	}
	_, err = mb.RememberChat(memory.ChatInput{Subject: "preference.tone", Kind: "preference", Quote: "I prefer casual replies.", ConversationID: "work-old", RunID: "run-old"})
	if err == nil {
		t.Fatal("forgotten concept was silently relearned")
	}
	c := Store{StateDir: temporary(t), Folder: shared}
	run(t, c)
	mc, _ := memory.Open(c.StateDir)
	if _, err = mc.Load(first.ID); !os.IsNotExist(err) {
		t.Fatal("new device resurrected a forgotten fact", err)
	}
	run(t, b)
}
func TestConcurrentEditsRequireExactResolutionAndDeletionWins(t *testing.T) {
	shared := temporary(t)
	a := Store{StateDir: temporary(t), Folder: shared}
	b := Store{StateDir: temporary(t), Folder: shared}
	ma, _ := memory.Open(a.StateDir)
	mb, _ := memory.Open(b.StateDir)
	r, _ := ma.Add("preference", "Keep replies short.", "", "", time.Time{})
	run(t, a)
	run(t, b)
	ma.Correct(r.ID, "Keep replies very short.", "")
	mb.Correct(r.ID, "Keep replies detailed.", "")
	run(t, a)
	conflict := run(t, b)
	if len(conflict.Conflicts) != 1 {
		t.Fatalf("expected a conflict: %+v", conflict)
	}
	item := conflict.Conflicts[0]
	var chosen string
	for _, v := range item.Choices {
		if v.Text == "Keep replies very short." {
			chosen = v.Hash
		}
	}
	if chosen == "" {
		t.Fatal("missing original alternative")
	}
	if _, err := b.Run(context.Background(), item.Key, "stale", chosen); err == nil {
		t.Fatal("stale conflict resolution accepted")
	}
	resolved, err := b.Run(context.Background(), item.Key, item.Revision, chosen)
	if err != nil || len(resolved.Conflicts) > 0 {
		t.Fatal(resolved, err)
	}
	run(t, a)
	value, _ := ma.Load(r.ID)
	if value.Text != "Keep replies very short." {
		t.Fatal(value)
	}
	ma.Forget(r.ID)
	mb.Correct(r.ID, "A concurrent edit before forgetting.", "")
	run(t, a)
	run(t, b)
	run(t, a)
	if _, err = mb.Load(r.ID); !os.IsNotExist(err) {
		t.Fatal("concurrent edit beat forgetting", err)
	}
}
func TestImmutablePacketsRejectTamperingAndNeverSyncCredentials(t *testing.T) {
	a := Store{StateDir: temporary(t), Folder: temporary(t)}
	m, _ := memory.Open(a.StateDir)
	m.Add("fact", "A safe fact.", "", "", time.Time{})
	os.WriteFile(filepath.Join(a.StateDir, "hot-cross-buns", "auth.json"), []byte(`{"secret":"never-share"}`), 0600)
	run(t, a)
	files, _ := os.ReadDir(filepath.Join(a.sharedDirectory(), "changes"))
	if len(files) == 0 {
		t.Fatal("no sync packet")
	}
	for _, file := range files {
		data, _ := os.ReadFile(filepath.Join(a.sharedDirectory(), "changes", file.Name()))
		if strings.Contains(string(data), "never-share") {
			t.Fatal("credential escaped into sync")
		}
	}
	path := filepath.Join(a.sharedDirectory(), "changes", files[0].Name())
	os.WriteFile(path, []byte("tampered"), 0600)
	if _, err := a.Run(context.Background(), "", "", ""); err == nil {
		t.Fatal("changed immutable revision accepted")
	}
}

func TestOfflineAliasCannotReviveAnAlreadyForgottenConcept(t *testing.T) {
	shared := temporary(t)
	a := Store{StateDir: temporary(t), Folder: shared}
	b := Store{StateDir: temporary(t), Folder: shared}
	ma, _ := memory.Open(a.StateDir)
	mb, _ := memory.Open(b.StateDir)
	original, err := ma.RememberChat(memory.ChatInput{Subject: "preference.tone", Kind: "preference", Quote: "I prefer casual replies.", ConversationID: "work-a", RunID: "run-a"})
	if err != nil {
		t.Fatal(err)
	}
	run(t, a)
	run(t, b)
	// A different record ID existed offline before this device learned the forget.
	extra, err := mb.Add("preference", "I prefer casual replies.", "", "", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	// Give that independently created record the same verified canonical subject.
	data, err := os.ReadFile(filepath.Join(b.StateDir, "hot-cross-buns", "memory", extra.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var record memory.Record
	if err = json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	record.Subject = "preference.tone"
	data, _ = json.Marshal(record)
	if err = os.WriteFile(filepath.Join(b.StateDir, "hot-cross-buns", "memory", extra.ID+".json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = ma.Forget(original.ID); err != nil {
		t.Fatal(err)
	}
	run(t, a)
	run(t, b)
	run(t, a)
	if _, err = mb.Load(extra.ID); !os.IsNotExist(err) {
		t.Fatal("offline alias survived forgetting", err)
	}
	c := Store{StateDir: temporary(t), Folder: shared}
	run(t, c)
	mc, _ := memory.Open(c.StateDir)
	records, err := mc.ListAll(true)
	if err != nil || len(records) != 0 {
		t.Fatal("fresh device recovered forgotten aliases", records, err)
	}
}

func TestSharedDirectoryLinksCannotWriteOutsideTheSelectedFolder(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires a local Windows privilege")
	}
	state, shared, outside := temporary(t), temporary(t), temporary(t)
	if err := os.Symlink(outside, filepath.Join(shared, "hcb-memory-profile")); err != nil {
		t.Fatal(err)
	}
	if _, err := (Store{StateDir: state, Folder: shared}).Run(context.Background(), "", "", ""); err == nil {
		t.Fatal("linked sync directory accepted")
	}
	entries, _ := os.ReadDir(outside)
	if len(entries) != 0 {
		t.Fatal("sync wrote outside its selected folder", entries)
	}
}
