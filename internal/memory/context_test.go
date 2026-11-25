package memory

import (
	"testing"
	"time"
)

func TestTemporalContextAndPinNeverOverrideRecallGuards(t *testing.T) {
	s, _ := Open(t.TempDir())
	at := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return at }
	r, err := s.RememberChat(ChatInput{Subject: "preference.format", Kind: "preference", Quote: "I prefer tables for work reports.", ConversationID: "work-context", RunID: "work-context-first", Context: &Context{Why: "Recurring report constraint", Importance: "constraint", State: "current", AppliesTo: []string{"reports"}, ValidUntil: at.Add(time.Hour)}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Applies("write a poem") || !r.Applies("prepare reports") {
		t.Fatal("conditional context leaked")
	}
	confirmed := r.LastConfirmedAt
	r, err = s.UpdatePolicy(r.ID, r.UpdatedAt.Format(time.RFC3339Nano), RecallPolicy{Pinned: true, SnoozedUntil: at.Add(time.Minute)})
	if err != nil || r.LastConfirmedAt != confirmed {
		t.Fatal(r, err)
	}
	rows, _ := s.List("", false)
	if rows[0].Recallable() {
		t.Fatal("pin bypassed snooze")
	}
	at = at.Add(2 * time.Minute)
	rows, _ = s.List("", false)
	if !rows[0].Recallable() {
		t.Fatal(rows)
	}
	at = at.Add(time.Hour)
	rows, _ = s.List("", false)
	if rows[0].Recallable() {
		t.Fatal("pin bypassed validity")
	}
	if _, err = s.UpdatePolicy(r.ID, "stale", RecallPolicy{}); err == nil {
		t.Fatal("stale policy accepted")
	}
}

func TestPlannedContextDoesNotBecomeOccurredAsTimePasses(t *testing.T) {
	s, _ := Open(t.TempDir())
	at := time.Now().UTC()
	s.now = func() time.Time { return at }
	r, err := s.RememberChat(ChatInput{Subject: "trip.singapore", Kind: "fact", Quote: "I plan to visit Singapore next month.", ConversationID: "work-trip", RunID: "work-trip-one", Context: &Context{Why: "Trip planning context", Importance: "useful", State: "planned", ValidUntil: at.Add(time.Hour), Timezone: "Asia/Singapore"}})
	if err != nil {
		t.Fatal(err)
	}
	at = at.Add(2 * time.Hour)
	rows, _ := s.List("", true)
	if rows[0].Recallable() || rows[0].Context.State != "planned" {
		t.Fatal("intention became an outcome", rows)
	}
	current, _ := s.Load(r.ID)
	if current.Revision() != r.Revision() {
		t.Fatal("time mutated source")
	}
}

func TestCorrectedTemporalClaimNeedsFreshApplicabilityReview(t *testing.T) {
	s, _ := Open(t.TempDir())
	r, err := s.RememberChat(ChatInput{Subject: "trip.singapore", Kind: "fact", Quote: "I plan to visit Singapore.", ConversationID: "work-plan", RunID: "work-plan-first", Context: &Context{Why: "Future trip", Importance: "useful", State: "planned"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.CorrectReviewed(r.ID, "I cancelled my Singapore visit.", r.Source, r.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := s.List("", true)
	if rows[0].Recallable() || !rows[0].Context.ReviewNeeded {
		t.Fatal("stale applicability survived correction", rows)
	}
	if _, err := s.ConfirmReviewed(r.ID, r.UpdatedAt.Format(time.RFC3339Nano)); err == nil {
		t.Fatal("age confirmation bypassed applicability review")
	}
}
