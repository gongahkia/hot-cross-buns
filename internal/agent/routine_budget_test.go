package agent

import "testing"

func TestRoutineBudgetNarrowsRemainingCapacityWithoutResettingUsage(t *testing.T) {
	b := &Budget{Limits: Limits{ModelRequests: 20, Tokens: 50000}}
	for range 3 {
		if err := b.reserve(); err != nil {
			t.Fatal(err)
		}
		b.record(Usage{InputTokens: 100, OutputTokens: 50, Reported: true})
	}
	if err := b.RestrictRemaining(2, 2000); err != nil {
		t.Fatal(err)
	}
	if b.Limits.ModelRequests != 5 || b.Limits.Tokens != 2450 || b.Usage().ModelRequests != 3 {
		t.Fatal(b.Limits, b.Usage())
	}
	if err := b.RestrictRemaining(100, 100000); err != nil || b.Limits.ModelRequests != 5 || b.Limits.Tokens != 2450 {
		t.Fatal("routine widened existing limits", b.Limits, err)
	}
	if err := b.reserve(); err != nil {
		t.Fatal(err)
	}
	if err := b.reserve(); err != nil {
		t.Fatal(err)
	}
	if err := b.reserve(); err != ErrBudget {
		t.Fatal("routine request cap was not enforced", err)
	}
}
