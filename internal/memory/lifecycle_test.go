package memory

import (
	"testing"
	"time"
)

func TestPersonalMemoryLifecycleAcrossMonthsCorrectionsAndForget(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	open := func() Store {
		s, err := Open(root)
		if err != nil {
			t.Fatal(err)
		}
		s.now = func() time.Time { return now }
		return s
	}
	s := open()
	in := ChatInput{Subject: "profile.city", Kind: "fact", Quote: "I live in Harbor City.", ConversationID: "work-chat-one", RunID: "run-one"}
	first, err := s.RememberChat(in)
	if err != nil {
		t.Fatal(err)
	}
	stable, err := s.RememberChat(ChatInput{Subject: "preference.response_length", Kind: "preference", Quote: "I prefer short replies.", ConversationID: "work-chat-one", RunID: "run-one"})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(30 * 24 * time.Hour)
	s = open()
	change := in
	change.RunID = "run-two"
	change.ConversationID = "work-chat-two"
	change.Quote = "I live in Cedar City."
	if _, err = s.RememberChat(change); err == nil {
		t.Fatal("conflicting fact replaced memory without an inspected revision")
	}
	change.ReplaceID, change.ExpectedUpdated = first.ID, first.UpdatedAt.Format(time.RFC3339Nano)
	corrected, err := s.RememberChat(change)
	if err != nil {
		t.Fatal(err)
	}
	s = open()
	if old, err := s.Search("Harbor City", "", 8); err != nil || len(old) != 0 {
		t.Fatal("old value was recalled after correction", old, err)
	}
	if current, err := s.Search("Cedar City", "", 8); err != nil || len(current) != 1 || current[0].ID != first.ID {
		t.Fatal("correction did not survive reopening", current, err)
	}
	now = now.Add(91 * 24 * time.Hour)
	s = open()
	if results, err := s.Search("Cedar City", "", 8); err != nil || len(results) != 0 {
		t.Fatal("aged fact was silently recalled", results, err)
	}
	if p, err := s.Profile(nil); err != nil || len(p) != 1 || p[0].ID != stable.ID {
		t.Fatal("stable preference did not survive", p, err)
	}
	if err = s.Forget(corrected.ID); err != nil {
		t.Fatal(err)
	}
	s = open()
	change.RunID = "run-three"
	if _, err = s.RememberChat(change); err == nil {
		t.Fatal("forgotten topic was silently relearned")
	}
	if _, err = s.Inspect(corrected.ID); err == nil {
		t.Fatal("forgotten fact remained available")
	}
}
