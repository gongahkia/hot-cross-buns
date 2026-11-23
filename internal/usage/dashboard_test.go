package usage

import (
	"testing"
	"time"
)

func TestDashboardAggregatesRetainedUTCWindowAndProviderModels(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 24, 1, 0, 0, 0, time.FixedZone("east", 14*60*60))
	utc := now.UTC()
	for _, charge := range []struct {
		offset   int
		provider string
		tokens   int64
		reported bool
	}{
		{0, "openai/gpt-5-mini", 20, true}, {0, "openai/gpt-5-mini", 30, false}, {0, "anthropic/claude", 10, true}, {-6, "openai/gpt-5-mini", 40, true}, {-7, "excluded/model", 100, true},
	} {
		reservation, err := store.Reserve(utc.AddDate(0, 0, charge.offset), "chat", charge.provider, 100)
		if err != nil {
			t.Fatal(err)
		}
		if err := reservation.Finish(charge.tokens, charge.reported, false, nil); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.Dashboard(now)
	if err != nil {
		t.Fatal(err)
	}
	if result.Day != "2026-11-23" || result.Requests != 3 || len(result.History) != 7 || result.History[0].Requests != 1 || result.History[6].Requests != 3 || result.History[1].Requests != 0 {
		t.Fatalf("incorrect UTC history: %+v", result)
	}
	if len(result.Providers) != 2 || result.Providers[0].Name != "openai/gpt-5-mini" || result.Providers[0].Requests != 2 || result.Providers[0].EstimatedRequests != 1 {
		t.Fatalf("incorrect provider aggregates: %+v", result.Providers)
	}
	var tokens int64
	for _, value := range result.Providers {
		tokens += value.Tokens
	}
	if tokens != result.Tokens || result.History[6].Tokens != result.Tokens {
		t.Fatal("charts and totals disagree")
	}
	empty, err := store.Dashboard(now.AddDate(0, 0, 8))
	if err != nil || len(empty.History) != 7 || empty.Requests != 0 || len(empty.Providers) != 0 {
		t.Fatalf("empty period: %+v %v", empty, err)
	}
}
