package memory

import (
	"context"
	"strings"
	"testing"
	"time"
)

func candidateFixture(t *testing.T, s Store) Candidate {
	t.Helper()
	input := ChatInput{Subject: "profile.city", Kind: "fact", Quote: "I plan to visit Singapore.", ConversationID: "work-candidate", RunID: "work-candidate-first", Context: &Context{Why: "Upcoming travel planning", Importance: "useful", State: "planned", AppliesTo: []string{"travel"}}}
	snapshot, err := s.SemanticSnapshot("", nil)
	if err != nil {
		t.Fatal(err)
	}
	plan := SemanticPlan{Relation: Distinct, SuggestedSubject: input.Subject, Snapshot: snapshot, StatementSHA256: textDigest(input.Quote)}
	c, err := s.ProposeCandidate(context.Background(), input, plan)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func TestCandidateIsInactiveUntilExactReviewAndCannotSurviveChangedSources(t *testing.T) {
	s, _ := Open(t.TempDir())
	c := candidateFixture(t, s)
	if rows, _ := s.List("", false); len(rows) != 0 {
		t.Fatal("proposal became active")
	}
	if _, err := s.ReviewCandidate(context.Background(), c.ID, "stale", "accept"); err == nil {
		t.Fatal("stale candidate accepted")
	}
	r, err := s.ReviewCandidate(context.Background(), c.ID, c.UpdatedAt.Format(time.RFC3339Nano), "accept")
	if err != nil || r.Context.State != "planned" {
		t.Fatal(r, err)
	}
	if pending, err := s.Candidates(); err != nil || len(pending) != 0 {
		t.Fatal(pending, err)
	}
	s2, _ := Open(t.TempDir())
	c2 := candidateFixture(t, s2)
	s2.Add("fact", "A new fact", "", "", time.Time{})
	pending, err := s2.Candidates()
	if err != nil || len(pending) != 1 || pending[0].Input.Quote != "" {
		t.Fatal(pending, err)
	}
	if _, err := s2.ReviewCandidate(context.Background(), c2.ID, c2.UpdatedAt.Format(time.RFC3339Nano), "accept"); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatal(err)
	}
	if _, err := s2.ReviewCandidate(context.Background(), c2.ID, c2.UpdatedAt.Format(time.RFC3339Nano), "reject"); err != nil {
		t.Fatal(err)
	}
	if pending, err := s2.Candidates(); err != nil || len(pending) != 0 {
		t.Fatal(pending, err)
	}
}
