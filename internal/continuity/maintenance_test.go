package continuity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestForegroundUsesCachedSummaryWithoutRunningMaintenance(t *testing.T) {
	root, s, chat := fixture(t, 0)
	seed(t, s, chat.ID, 0, 32, strings.Repeat("Historical detail SAFFRON. ", 30))
	probe := &testModel{}
	model := agent.WithContextPolicy(probe, agent.ContextPolicy{Window: 16384, OutputReserve: 2048})
	opts := Options{ConversationID: chat.ID, Query: "SAFFRON", Main: true}
	before, err := Build(context.Background(), root, model, opts)
	if err != nil || len(probe.requests) != 0 || before.Covered != 0 {
		t.Fatal("reply ran maintenance", len(probe.requests), err)
	}
	more, err := Maintain(context.Background(), root, model, opts, nil)
	if err != nil || !more || len(probe.requests) > 2 {
		t.Fatal("bounded maintenance", more, len(probe.requests), err)
	}
	calls := len(probe.requests)
	after, err := Build(context.Background(), root, model, opts)
	if err != nil || after.Covered == 0 || after.Summary == "" || len(probe.requests) != calls {
		t.Fatal("cached summary not reused", after.Covered, len(probe.requests), err)
	}
}
func TestMaintenanceRejectsRevokedScopeAndChangedMemory(t *testing.T) {
	for _, kind := range []string{"scope", "memory"} {
		t.Run(kind, func(t *testing.T) {
			root, s, chat := fixture(t, 0)
			seed(t, s, chat.ID, 0, 32, strings.Repeat("SAFFRON source data. ", 40))
			revoked := false
			probe := &testModel{onSummary: func() {
				revoked = true
				if kind == "memory" {
					m, _ := memory.Open(root)
					if _, err := m.Add("preference", "Updated source", "", "user", time.Time{}); err != nil {
						t.Fatal(err)
					}
				}
			}}
			model := agent.WithContextPolicy(probe, agent.ContextPolicy{Window: 16384, OutputReserve: 2048})
			check := func() error {
				if revoked && kind == "scope" {
					return errors.New("scope revoked")
				}
				return nil
			}
			_, err := Maintain(context.Background(), root, model, Options{ConversationID: chat.ID}, check)
			if err == nil {
				t.Fatal("published changed authority or memory")
			}
			nodes, err := s.ReadHistoryNodes(context.Background(), worksession.HistoryQuery{Chat: chat.ID})
			if err != nil || len(nodes) != 0 {
				t.Fatal("stale summary published", nodes, err)
			}
		})
	}
}

func TestMaintenanceMakesProgressWithWithdrawalScreeningWithinClaimBudget(t *testing.T) {
	root, s, chat := fixture(t, 0)
	seed(t, s, chat.ID, 0, 32, strings.Repeat("Unrelated SAFFRON work. ", 35))
	memories, _ := memory.Open(root)
	record, err := memories.RememberChat(memory.ChatInput{Subject: "preference.response_length", Kind: "preference", Quote: "I prefer short replies.", ConversationID: chat.ID, RunID: "run-first"})
	if err != nil {
		t.Fatal(err)
	}
	if err := memories.Forget(record.ID); err != nil {
		t.Fatal(err)
	}
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 8, Tokens: 200000}}
	probe := &testModel{}
	model := agent.WithBudget(agent.WithContextPolicy(probe, agent.ContextPolicy{Window: 16384, OutputReserve: 2048}), budget)
	more, err := Maintain(context.Background(), root, model, Options{ConversationID: chat.ID}, nil)
	if err != nil || !more || budget.Usage().ModelRequests > 8 {
		t.Fatal("privacy checks starved summarization", more, budget.Usage(), err)
	}
	nodes, err := s.ReadHistoryNodes(context.Background(), worksession.HistoryQuery{Chat: chat.ID})
	if err != nil || len(nodes) == 0 || nodes[0].Covered != 4 {
		t.Fatal("bounded screened section was not published", nodes, err)
	}
}
