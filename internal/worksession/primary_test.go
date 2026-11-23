package worksession

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestPrimaryKeepsIndependentTopicsAndSurvivesReopen(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	older, _ := store.Create("Private topic", "/private", "snap-private", time.Now())
	if id, err := store.Primary(); err != nil || id != "" {
		t.Fatalf("adopted existing topic: %q %v", id, err)
	}
	main, _ := store.Create("Main", "/main", "snap-main", time.Now())
	if err := store.BindPrimary(main.ID); err != nil {
		t.Fatal(err)
	}
	reopened, _ := Open(directory)
	if id, err := reopened.Primary(); err != nil || id != main.ID {
		t.Fatalf("lost primary: %q %v", id, err)
	}
	if err := reopened.BindPrimary(older.ID); err == nil {
		t.Fatal("replaced another window's primary")
	}
	if err := reopened.BindPrimary(main.ID); err != nil {
		t.Fatal(err)
	}
	if record, err := reopened.Load(older.ID); err != nil || record.SourcePath != "/private" {
		t.Fatalf("changed independent topic: %+v %v", record, err)
	}
	if err := os.RemoveAll(filepath.Join(store.root, main.ID)); err != nil {
		t.Fatal(err)
	}
	if id, err := reopened.Primary(); err != nil || id != "" {
		t.Fatalf("retained deleted primary: %q %v", id, err)
	}
	if err := reopened.BindPrimary(older.ID); err != nil {
		t.Fatal(err)
	}
}

func TestPrimaryRejectsCorruption(t *testing.T) {
	store, _ := Open(t.TempDir())
	if err := os.WriteFile(filepath.Join(store.root, "primary.json"), []byte(`{"version":1,"conversation_id":"../outside"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Primary(); err == nil {
		t.Fatal("accepted invalid identity")
	}
	if _, err := store.EnsurePrimary(t.TempDir(), time.Now()); err == nil {
		t.Fatal("silently replaced a corrupt main designation")
	}
}

func TestEnsurePrimaryIsStableAcrossConcurrentLaunchesAndTopicNavigation(t *testing.T) {
	root, source := t.TempDir(), t.TempDir()
	s, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	topic, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetActive(topic.ID); err != nil {
		t.Fatal(err)
	}
	const count = 8
	ids := make(chan string, count)
	errors := make(chan error, count)
	var group sync.WaitGroup
	for range count {
		group.Add(1)
		go func() {
			defer group.Done()
			store, err := Open(root)
			if err != nil {
				errors <- err
				return
			}
			main, err := store.EnsurePrimary(source, time.Now())
			if err != nil {
				errors <- err
				return
			}
			ids <- main.ID
		}()
	}
	group.Wait()
	close(ids)
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	mainID, err := s.Primary()
	if err != nil || mainID == "" || mainID == topic.ID {
		t.Fatal("adopted topic or lost main", mainID, err)
	}
	for id := range ids {
		if id != mainID {
			t.Fatal("concurrent launch created another main", id)
		}
	}
	items, err := s.List(0)
	if err != nil || len(items) != 2 {
		t.Fatal("created duplicate empty chats", len(items), err)
	}
	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	main, err := reopened.EnsurePrimary(t.TempDir(), time.Now())
	if err != nil || main.ID != mainID || main.SourcePath != source || main.HeadRevision != "" {
		t.Fatal("restart changed main scope or created work", main, err)
	}
	if active, _ := s.RetainedActive(); active != topic.ID {
		t.Fatal("changed the explicit topic selection")
	}
	otherProfile, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	other, err := otherProfile.EnsurePrimary(source, time.Now())
	if err != nil || other.ID == mainID {
		t.Fatal("shared main across profiles", other, err)
	}
	if err := os.RemoveAll(filepath.Join(s.root, mainID)); err != nil {
		t.Fatal(err)
	}
	replacement, err := s.EnsurePrimary(source, time.Now())
	if err != nil || replacement.ID == mainID || replacement.ID == topic.ID {
		t.Fatal("reused deleted main or adopted topic", replacement, err)
	}
}
