package continuity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

type testModel struct {
	response  *agent.Turn
	requests  []agent.TurnRequest
	fail      bool
	onSummary func()
	block     string
}

func (m *testModel) Complete(_ context.Context, r agent.TurnRequest) (agent.Turn, error) {
	m.requests = append(m.requests, r)
	if strings.Contains(r.System, "historical-context privacy filter") {
		var checks []struct{ ID, User, Assistant, Title, Folder string }
		if err := json.Unmarshal([]byte(r.Messages[0].Content), &checks); err != nil {
			return agent.Turn{}, err
		}
		var verdicts []map[string]string
		for _, c := range checks {
			v := "clear"
			if m.block != "" && strings.Contains(c.User+c.Assistant+c.Title+c.Folder, m.block) {
				v = "blocked"
			}
			verdicts = append(verdicts, map[string]string{"id": c.ID, "verdict": v})
		}
		data, _ := json.Marshal(map[string]any{"verdicts": verdicts})
		return agent.Turn{Text: string(data)}, nil
	}
	if m.onSummary != nil {
		m.onSummary()
	}
	if m.fail {
		return agent.Turn{}, errors.New("temporary summary failure")
	}
	if m.response != nil {
		return *m.response, nil
	}
	return agent.Turn{Text: "Launch marker SAFFRON. The user is comparing two plans; the booking remains unconfirmed."}, nil
}
func seed(t *testing.T, s worksession.Store, chat string, start, count int, marker string) {
	t.Helper()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := start; i < start+count; i++ {
		turn, err := s.AdmitDialogue(chat, fmt.Sprintf("continuity-message-%04d", i), fmt.Sprintf("Message %d: %s", i, marker), json.RawMessage(`{"private_token":"NEVER-FORWARD-THIS","run_options":{}}`), at.Add(time.Duration(i)*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = s.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State, turn.Response, turn.Decision = "answered", fmt.Sprintf("Response %d", i), json.RawMessage(`{"kind":"reply","text":"recorded response"}`)
		if _, err = s.UpdateDialogue(turn, turn.Revision); err != nil {
			t.Fatal(err)
		}
	}
}
func fixture(t *testing.T, count int) (string, worksession.Store, worksession.Conversation) {
	t.Helper()
	root := t.TempDir()
	s, err := worksession.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	seed(t, s, chat.ID, 0, count, "SAFFRON launch")
	return root, s, chat
}

func TestSummaryPersistsAcrossRestartExtendsWithoutGapsAndKeepsRecentDetail(t *testing.T) {
	root, s, chat := fixture(t, 20)
	model := &testModel{}
	options := Options{ConversationID: chat.ID, Main: true, Query: "SAFFRON launch"}
	first, err := Build(context.Background(), root, model, options)
	if err != nil {
		t.Fatal(err)
	}
	if first.Covered != 12 || len(first.Recent) != 16 || !strings.Contains(first.Summary, "SAFFRON") {
		t.Fatal("missing summary or recent context", first)
	}
	if !strings.Contains(model.requests[0].Messages[0].Content, "Message 0") || strings.Contains(model.requests[0].Messages[0].Content, "NEVER-FORWARD") {
		t.Fatal("wrong public compaction input")
	}
	prior, err := s.ReadContinuity(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	model.requests = nil
	again, err := Build(context.Background(), root, model, options)
	if err != nil {
		t.Fatal(err)
	}
	if len(model.requests) != 0 || again.Summary != first.Summary {
		t.Fatal("restart recomputed unchanged summary")
	}
	seed(t, s, chat.ID, 20, 2, "new details")
	next, err := Build(context.Background(), root, model, options)
	if err != nil {
		t.Fatal(err)
	}
	if len(model.requests) != 0 || next.Covered != 12 || len(next.Recent) != 20 {
		t.Fatal("batching lost unsummarized recent turns", next)
	}
	seed(t, s, chat.ID, 22, 2, "more details")
	next, err = Build(context.Background(), root, model, options)
	if err != nil {
		t.Fatal(err)
	}
	if next.Covered != 16 || len(model.requests) != 2 || strings.Contains(model.requests[0].Messages[0].Content, "Message 0:") || !strings.Contains(model.requests[0].Messages[0].Content, "Message 12:") || !strings.Contains(model.requests[1].Messages[0].Content, "Launch marker SAFFRON") {
		t.Fatal("did not build independent section and parent overview")
	}
	if err := s.SaveContinuity(prior, prior.Revision); err == nil {
		t.Fatal("stale summary overwrote newer context")
	}
}

func TestCorrectionsExclusionsAndForgettingRefreshContextWithoutRevivingHistory(t *testing.T) {
	root, s, chat := fixture(t, 16)
	memories, err := memory.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	record, err := memories.RememberChat(memory.ChatInput{Subject: "preference.response_length", Kind: "preference", Quote: "I prefer short replies.", ConversationID: chat.ID, RunID: "run-first"})
	if err != nil {
		t.Fatal(err)
	}
	model := &testModel{}
	o := Options{ConversationID: chat.ID, Query: "reply preference", Main: true}
	first, err := Build(context.Background(), root, model, o)
	if err != nil || len(first.Memories) != 1 {
		t.Fatal(first, err)
	}
	if _, err := memories.Correct(record.ID, "I prefer detailed replies.", "user"); err != nil {
		t.Fatal(err)
	}
	corrected, err := Build(context.Background(), root, model, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(corrected.Memories) != 1 || corrected.Memories[0].Text != "I prefer detailed replies." {
		t.Fatal("old saved fact survived correction", corrected.Memories)
	}
	o.Excluded = []string{record.ID}
	excluded, err := Build(context.Background(), root, model, o)
	if err != nil || len(excluded.Memories) != 0 {
		t.Fatal("excluded memory returned", excluded, err)
	}
	o.Excluded = nil
	if err := memories.Forget(record.ID); err != nil {
		t.Fatal(err)
	}
	model.block = "SAFFRON"
	forgotten, err := Build(context.Background(), root, model, o)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(forgotten)
	if len(forgotten.Memories) != 0 || strings.Contains(string(data), "SAFFRON") {
		t.Fatal("withdrawn historical content resurfaced", string(data))
	}
	saved, err := s.ReadContinuity(chat.ID)
	if err != nil || strings.Contains(saved.Text, "SAFFRON") {
		t.Fatal("stale derived summary survived withdrawal", saved, err)
	}
}

func TestSummaryFailuresPreserveHistoryAndRecoverOnNextRequest(t *testing.T) {
	root, s, chat := fixture(t, 18)
	model := &testModel{fail: true}
	o := Options{ConversationID: chat.ID}
	result, err := Build(context.Background(), root, model, o)
	if err != nil || result.Summary != "" || len(result.Notices) == 0 || len(result.Recent) == 0 {
		t.Fatal("no truthful fallback", result, err)
	}
	if saved, err := s.ReadContinuity(chat.ID); err != nil || saved.Revision != 0 {
		t.Fatal("failed summary published", saved, err)
	}
	model.fail = false
	result, err = Build(context.Background(), root, model, o)
	if err != nil || result.Covered != 10 {
		t.Fatal("could not recover", result, err)
	}
	history, err := s.ContextHistory(chat.ID, 0, time.Time{})
	if err != nil || len(history) != 18 {
		t.Fatal("compaction removed original history", len(history), err)
	}
}

func TestRecallIncludesDialogueHonorsOptOutAndGoalBoundaries(t *testing.T) {
	root, s, chat := fixture(t, 0)
	other, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	seed(t, s, other.ID, 0, 1, "ceramic kiln budget")
	goals, err := goal.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	g, err := goals.Add("Private ceramic kiln", "", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	private, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := goals.AttachConversation(g.ID, private.ID); err != nil {
		t.Fatal(err)
	}
	seed(t, s, private.ID, 0, 1, "ceramic kiln secret")
	o := Options{ConversationID: chat.ID, Query: "ceramic kiln", ReferToChats: true}
	result, err := Build(context.Background(), root, &testModel{}, o)
	if err != nil || len(result.Recalled) != 1 || result.Recalled[0].ConversationID != other.ID {
		t.Fatal("missing dialogue recall or crossed goal scope", result, err)
	}
	o.ReferToChats = false
	result, err = Build(context.Background(), root, &testModel{}, o)
	if err != nil || len(result.Recalled) != 0 {
		t.Fatal("earlier-chat opt out ignored", result, err)
	}
}

func TestMemoryMutationDuringSummaryRejectsPreparedContext(t *testing.T) {
	root, _, chat := fixture(t, 16)
	memories, _ := memory.Open(root)
	r, err := memories.RememberChat(memory.ChatInput{Subject: "profile.name", Kind: "fact", Quote: "My name is Mira.", ConversationID: chat.ID, RunID: "run-first"})
	if err != nil {
		t.Fatal(err)
	}
	model := &testModel{onSummary: func() {
		if err := memories.Forget(r.ID); err != nil {
			t.Fatal(err)
		}
	}}
	if _, err := Build(context.Background(), root, model, Options{ConversationID: chat.ID}); err == nil {
		t.Fatal("returned context prepared before a concurrent forget")
	}
}

func TestCommitmentsAndPendingTasksRefreshFromStoresWithoutClaimingLiveExecution(t *testing.T) {
	root, s, chat := fixture(t, 0)
	goals, _ := goal.Open(root)
	g, err := goals.Add("Prepare a trip", "Compare train options", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plan, err := goals.ApplyPlanChange(g.ID, goal.PlanChange{Kind: "add_step", Title: "Choose a train", ExpectedRevision: 0})
	if err != nil {
		t.Fatal(err)
	}
	r, err := worksession.NewRequest("Prepare a booking draft", json.RawMessage(`{}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	journal, err := s.SaveRequests(chat.ID, worksession.RequestJournal{Version: 1, Requests: []worksession.Request{r}})
	if err != nil {
		t.Fatal(err)
	}
	store, _ := jobs.Open(root)
	job, err := store.Save(jobs.Definition{Name: "Morning check", Enabled: true, Schedule: "0 9 * * *", Timezone: "UTC", SourcePath: chat.SourcePath, Objective: "Review pending plans", Mode: action.Inspect, Contract: artifact.InspectionContract()})
	if err != nil {
		t.Fatal(err)
	}
	o := Options{ConversationID: chat.ID, Main: true}
	model := &testModel{}
	first, err := Build(context.Background(), root, model, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Commitments) != 1 || len(first.Commitments[0].Steps) != 1 || len(first.Tasks) != 1 || !first.Tasks[0].NeedsInspection || len(first.Schedules) != 1 || !first.Schedules[0].RequiresOnlineHost {
		t.Fatal("missing owned commitments", first)
	}
	if _, err := goals.ApplyPlanChange(g.ID, goal.PlanChange{Kind: "update_step", StepID: plan.Steps[0].ID, Status: goal.StepDone, ExpectedRevision: plan.Revision}); err != nil {
		t.Fatal(err)
	}
	journal.Requests[0].State = "completed"
	if _, err := s.SaveRequests(chat.ID, journal); err != nil {
		t.Fatal(err)
	}
	job.Enabled = false
	if _, err := store.Save(job); err != nil {
		t.Fatal(err)
	}
	next, err := Build(context.Background(), root, model, o)
	if err != nil || len(next.Commitments[0].Steps) != 0 || len(next.Tasks) != 0 || len(next.Schedules) != 0 {
		t.Fatal("stale unfinished state persisted", next, err)
	}
	o.Main = false
	scoped, err := Build(context.Background(), root, model, o)
	if err != nil || len(scoped.Commitments) != 0 {
		t.Fatal("unscoped side chat received unrelated responsibilities", scoped, err)
	}
}

func TestForkDoesNotInheritFutureSummaryAndHistoricalPreparationCannotRollBackCache(t *testing.T) {
	root, s, chat := fixture(t, 24)
	model := &testModel{}
	if _, err := Build(context.Background(), root, model, Options{ConversationID: chat.ID}); err != nil {
		t.Fatal(err)
	}
	before, err := s.ReadContinuity(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	turns, _, err := s.DialoguePage(chat.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	selected := turns[9]
	fork, err := s.ForkDialogueOnce(chat.ID, selected.ID, selected.Revision, "continuity-fork-request-001", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	child, err := Build(context.Background(), root, model, Options{ConversationID: fork.ID})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range child.Recent {
		if strings.Contains(m.Text, "Message 20:") {
			t.Fatal("fork inherited future context")
		}
	}
	if _, err := Build(context.Background(), root, model, Options{ConversationID: chat.ID, BeforeSequence: selected.Sequence, BeforeTime: selected.CreatedAt}); err != nil {
		t.Fatal(err)
	}
	after, err := s.ReadContinuity(chat.ID)
	if err != nil || before.Revision != after.Revision || before.Digest != after.Digest {
		t.Fatal("older task rolled back the newer main summary", before, after, err)
	}
}

func TestMalformedSummariesCannotReplaceRetainedContext(t *testing.T) {
	for name, turn := range map[string]agent.Turn{"empty": {}, "oversize": {Text: strings.Repeat("x", 12*1024+1)}, "invalid-utf8": {Text: "\xff"}, "controls": {Text: "bad\x00summary"}, "tool-call": {Text: "claimed result", ToolCalls: []agent.ToolCall{{ID: "invented", Name: "execute"}}}} {
		t.Run(name, func(t *testing.T) {
			root, s, chat := fixture(t, 12)
			result, err := Build(context.Background(), root, &testModel{response: &turn}, Options{ConversationID: chat.ID})
			if err != nil || result.Summary != "" || len(result.Notices) == 0 {
				t.Fatal("invalid summary trusted", result, err)
			}
			saved, err := s.ReadContinuity(chat.ID)
			if err != nil || saved.Revision != 0 {
				t.Fatal("invalid summary published", saved, err)
			}
		})
	}
}

func TestChatSelectionKeepsConditionalPlannedContextScopedEvenWhenPinned(t *testing.T) {
	root, _, chat := fixture(t, 0)
	s, _ := memory.Open(root)
	r, err := s.RememberChat(memory.ChatInput{Subject: "trip.singapore", Kind: "fact", Quote: "I plan to visit Singapore.", ConversationID: chat.ID, RunID: "run-planned", Context: &memory.Context{Why: "Future travel planning", Importance: "useful", State: "planned", AppliesTo: []string{"travel"}}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.UpdatePolicy(r.ID, r.UpdatedAt.Format(time.RFC3339Nano), memory.RecallPolicy{Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	unrelated, err := Build(context.Background(), root, &testModel{}, Options{ConversationID: chat.ID, Query: "Write a poem", Main: true})
	if err != nil || len(unrelated.Memories) != 0 {
		t.Fatal(unrelated, err)
	}
	relevant, err := Build(context.Background(), root, &testModel{}, Options{ConversationID: chat.ID, Query: "Help with travel planning", Main: true})
	if err != nil || len(relevant.Memories) != 1 || relevant.Memories[0].Context.State != "planned" || len(relevant.RecallTrace) != 1 {
		t.Fatal(relevant, err)
	}
	if _, err := s.CorrectReviewed(r.ID, "I cancelled the visit.", r.Source, r.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	corrected, err := Build(context.Background(), root, &testModel{}, Options{ConversationID: chat.ID, Query: "travel planning", Main: true})
	if err != nil || len(corrected.Memories) != 0 {
		t.Fatal("uncertain applicability entered chat", corrected, err)
	}
}

func TestModelWindowControlsRecentDetailAndPreparedContextSize(t *testing.T) {
	root, s, chat := fixture(t, 0)
	seed(t, s, chat.ID, 0, 32, "SAFFRON launch. "+strings.Repeat("A detailed conversation about daily work and its exact constraints. ", 10))
	options := Options{ConversationID: chat.ID, Query: "What did we decide about SAFFRON?", Main: true}
	probe := &testModel{}
	large := agent.WithContextPolicy(probe, agent.ContextPolicy{Window: 262144, OutputReserve: 8192})
	full, err := Build(context.Background(), root, large, options)
	if err != nil || len(probe.requests) > 0 || len(full.Recent) != 64 {
		t.Fatal("larger window did not retain fitting exact turns", len(full.Recent), len(probe.requests), err)
	}
	small := agent.WithContextPolicy(probe, agent.ContextPolicy{Window: 16384, OutputReserve: 2048})
	bounded, err := Build(context.Background(), root, small, options)
	if err != nil || len(bounded.Recent) >= len(full.Recent) || bounded.Covered == 0 {
		t.Fatal("smaller model did not compact", bounded.Covered, len(bounded.Recent), err)
	}
	raw, _ := json.Marshal(bounded)
	if agent.ContextFor(small).Count(string(raw)) > budgetFor(small, options.Query).total {
		t.Fatal("JSON context exceeds selected model allocation")
	}
	original, _, err := s.DialoguePage(chat.ID, 0, 100)
	if err != nil || len(original) != 32 || !strings.Contains(original[0].Text, "exact constraints") {
		t.Fatal("compaction modified canonical history", err)
	}
}

func TestArchiveSummaryAllocationScalesBeyondTheCompatibilityView(t *testing.T) {
	var nodes []worksession.HistoryNode
	for i := 0; i < 8; i++ {
		nodes = append(nodes, worksession.HistoryNode{ID: fmt.Sprint("section-", i), Text: strings.Repeat("Source-backed historical detail. ", 300)})
	}
	p := agent.ContextPolicy{Window: 262144, OutputReserve: 8192}
	large := archiveSummary(nodes, contextBudget{profile: p, adaptive: true, summary: 32768})
	small := archiveSummary(nodes, contextBudget{profile: p, adaptive: true, summary: 2048})
	if len(large) <= 12*1024 || p.Count(large) > 32768 || p.Count(small) > 2048 || len(small) >= len(large) {
		t.Fatal("archive text ignored model allocation", len(large), len(small))
	}
}
