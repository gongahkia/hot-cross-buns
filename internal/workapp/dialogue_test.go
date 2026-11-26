package workapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func dialogueConfig(t *testing.T) (Config, worksession.Store) {
	t.Helper()
	config, store := requestConfig(t, func(_, _, _ string, _ RunOptions) RunResult { return RunResult{FinalText: "A retained result"} })
	config.ManagedSessions = true
	config.RouteConversation = func(context.Context, workrun.ConversationRequest, ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "reply", Text: "You can keep talking."}, nil
	}
	config.BindConversationTask = func(parent, turn, source string, revision uint64) (worksession.DialogueTurn, worksession.Conversation, bool, error) {
		return store.BindDialogueTask(parent, turn, source, revision, time.Now())
	}
	config.ValidateUploads = func(string, []string, []string) error { return nil }
	return config, store
}
func dialogueSubmit(t *testing.T, m Model, id, text string, files ...string) (Model, tea.Cmd) {
	t.Helper()
	next, cmd := m.SubmitBridgeUploads(BridgeUploadSubmission{RequestID: id, Context: "conversation:" + m.conversation, Text: text, Files: files})
	m = next.(Model)
	if m.bridgeUploadResult.Error != "" {
		t.Fatal(m.bridgeUploadResult.Error)
	}
	return m, cmd
}
func routeDialogue(t *testing.T, m Model, cmd tea.Cmd) Model {
	t.Helper()
	if cmd == nil {
		t.Fatal("routing was not scheduled")
	}
	next, _ := m.Update(cmd())
	return next.(Model)
}

func TestDialogueOrdinaryComposerAdmissionRetainsInputsAndDoesNotWaitForWork(t *testing.T) {
	config, store := dialogueConfig(t)
	calls := 0
	config.RouteConversation = func(_ context.Context, request workrun.ConversationRequest, input ConversationInput) (workrun.ConversationDecision, error) {
		calls++
		if len(request.Recent) != 1 || request.Recent[0].Role != "user" || input.Source != "/captured" || input.RunOptions.MaxSteps != 12 {
			t.Fatalf("lost captured context: %+v %+v", request, input)
		}
		return workrun.ConversationDecision{Kind: "reply", Text: "You can keep talking."}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	// The durable parent is authoritative; this test captures the same source.
	config.CurrentFolder = "/captured"
	chat, err := store.CreateChat(config.CurrentFolder, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	config.StartConversationID = chat.ID
	m = New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.running = true
	m.options.MaxSteps = 12
	m.messages = []message{{role: "You", text: "Compare venues", createdAt: time.Now()}}
	file := strings.Repeat("a", 32) + "/brief.txt"
	m.options.Attachments = []string{"notes.txt"}
	m, cmd := dialogueSubmit(t, m, "hello-message-0001", "Hello", file)
	if len(m.queue) != 0 || !m.running || cmd == nil || len(m.dialogueTurns) != 1 || m.dialogueTurns[0].State != "routing" {
		t.Fatal("message queued behind work or was not durably admitted")
	}
	turn, err := store.ReadDialogue(m.conversation, m.dialogueTurns[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	var envelope ConversationInput
	if json.Unmarshal(turn.Options, &envelope) != nil || len(envelope.RunOptions.Uploads) != 1 || len(envelope.RunOptions.Attachments) != 1 || len(m.options.Attachments) != 0 {
		t.Fatal("captured input was lost or leaked into another submission")
	}
	m.options.MaxSteps = 24
	m = routeDialogue(t, m, cmd)
	if !m.running || len(m.queue) != 0 || m.dialogueTurns[0].Response != "You can keep talking." {
		t.Fatal("reply changed execution ownership")
	}
	m, retry := dialogueSubmit(t, m, "hello-message-0001", "Hello", file)
	if retry != nil || calls != 1 || len(m.dialogueTurns) != 1 {
		t.Fatal("acknowledgement retry routed or admitted twice")
	}
	next, _ := m.SubmitBridgeUploads(BridgeUploadSubmission{RequestID: "hello-message-0001", Context: "conversation:" + m.conversation, Text: "Different"})
	if next.(Model).bridgeUploadResult.Error == "" {
		t.Fatal("reused identity accepted different text")
	}
	config.StartConversationID = m.conversation
	restored := New(config)
	if restored.dialogueTurns[0].Response != "You can keep talking." || restored.dialogueRouting != "" || len(restored.dialogueQueue) != 0 {
		t.Fatal("restoration lost the answer or replayed routing")
	}
}

func TestDialogueTaskLaunchHasIndependentDurableAdmissionAndNoRetryReplay(t *testing.T) {
	config, store := dialogueConfig(t)
	config.RouteConversation = func(context.Context, workrun.ConversationRequest, ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "task"}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.running = true
	m, cmd := dialogueSubmit(t, m, "independent-0001", "Read this brief", strings.Repeat("b", 32)+"/brief.txt")
	m = routeDialogue(t, m, cmd)
	if m.dialogueDispatch == nil || m.dialogueTurns[0].Response != "" {
		t.Fatal("missing dispatch or claimed work started before acceptance")
	}
	dispatch := *m.dialogueDispatch
	if dispatch.ChildID == m.conversation {
		t.Fatal("independent task reused parent owner")
	}
	childConfig := config
	childConfig.StartConversationID = dispatch.ChildID
	child := New(childConfig)
	if !child.background {
		t.Fatal("child remembered itself before being focused")
	}
	wrong, _ := child.BootstrapDialogue("wrong-parent", dispatch.TurnID)
	if wrong.(Model).dialogueBootstrapResult.Error == "" {
		t.Fatal("forged origin was accepted")
	}
	next, run := child.BootstrapDialogue(m.conversation, dispatch.TurnID)
	child = next.(Model)
	if child.dialogueBootstrapResult.Error != "" || run == nil || len(child.requests.Requests) != 1 {
		t.Fatal("child admission failed", child.dialogueBootstrapResult)
	}
	var options RunOptions
	if json.Unmarshal(child.requests.Requests[0].Options, &options) != nil || options.DialogueParent != m.conversation || options.DialogueTurn != dispatch.TurnID || len(options.Uploads) != 1 {
		t.Fatal("child lost origin/inputs")
	}
	if journal, err := store.LoadRequests(m.conversation); err != nil || len(journal.Requests) != 0 {
		t.Fatal("child changed parent work journal", err)
	}
	next, retry := child.BootstrapDialogue(m.conversation, dispatch.TurnID)
	child = next.(Model)
	if retry != nil || child.dialogueBootstrapResult.Error != "" {
		t.Fatal("duplicate bootstrap dispatched again")
	}
	next, _ = m.FinishDialogueDispatch(*child.dialogueBootstrapResult)
	m = next.(Model)
	if m.dialogueTurns[0].State != "delegated" || m.dialogueDispatch != nil {
		t.Fatal("accepted child was not acknowledged")
	}
	next, _ = child.Update(run())
	child = next.(Model)
	if state := child.dialogueTaskState(); state == nil || state.State != "completed" || state.Summary != "A retained result" {
		t.Fatalf("result not attached to original task: %+v", state)
	}
	child.messages = append(child.messages, message{role: "Hot Cross Buns", text: "Unrelated settings changed."})
	if state := child.dialogueTaskState(); state == nil || state.Summary != "A retained result" {
		t.Fatal("a later local message replaced the original task result", state)
	}
	m.running = false
	peer := child.dialogueTaskState().DialoguePeer
	peer.CanGuide, peer.CanStop = true, true // A terminal projection cannot restore controls.
	m = m.ConfigureDialogueHost(DialogueHost{CanStart: true, Peers: []DialoguePeer{peer}})
	if !m.conversationActive() {
		t.Fatal("finished work disabled conversational continuity")
	}
	tasks := m.conversationTasks()
	if len(tasks) != 1 || tasks[0].Summary != "A retained result" || tasks[0].ID != dispatch.ChildID || tasks[0].CanGuide || tasks[0].CanStop {
		t.Fatalf("result context lost its owner or acquired controls: %+v", tasks)
	}
	config.RouteConversation = func(_ context.Context, request workrun.ConversationRequest, input ConversationInput) (workrun.ConversationDecision, error) {
		if len(request.Tasks) != 1 || request.Tasks[0].Summary != "A retained result" || len(input.TaskContext) != 1 || input.TaskContext[0].CanGuide || input.TaskContext[0].CanStop {
			t.Fatalf("result not retained for follow-up execution: %+v %+v", request, input)
		}
		return workrun.ConversationDecision{Kind: "reply", Text: "That task returned a retained result."}, nil
	}
	m.config.RouteConversation = config.RouteConversation
	m, follow := dialogueSubmit(t, m, "result-followup-0001", "What did it find?")
	m = routeDialogue(t, m, follow)
	if m.running || m.dialogueTurns[len(m.dialogueTurns)-1].State != "answered" || len(m.requests.Requests) != 0 {
		t.Fatal("idle follow-up started unrelated Work")
	}
	restored := New(childConfig)
	next, retry = restored.BootstrapDialogue(m.conversation, dispatch.TurnID)
	if retry != nil || next.(Model).dialogueBootstrapResult.Error != "" {
		t.Fatal("restart replayed a completed task")
	}
}

func TestAgentSelectedPlanModeCannotBootstrapExecution(t *testing.T) {
	config, _ := dialogueConfig(t)
	config.RouteConversation = func(context.Context, workrun.ConversationRequest, ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "plan"}, nil
	}
	config.Run = func(string, string, string, RunOptions) RunResult {
		t.Fatal("plan mode dispatched implementation")
		return RunResult{}
	}
	config.PreparePlan = func(context.Context, worksession.Request) (worksession.PlanContent, error) {
		return worksession.PlanContent{Outcome: "Clarify scope", Steps: []worksession.PlanStep{{ID: "read", Text: "Inspect after review"}}, Effects: []string{"read"}, Questions: []worksession.PlanQuestion{{ID: "scope", Question: "Which scope?"}}}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.primary = true
	m, cmd := dialogueSubmit(t, m, "agent-plan-000001", "Improve the parser")
	m = routeDialogue(t, m, cmd)
	if m.dialogueDispatch == nil {
		t.Fatal("plan was not delegated")
	}
	dispatch := *m.dialogueDispatch
	childConfig := config
	childConfig.StartConversationID = dispatch.ChildID
	child := New(childConfig)
	next, prepare := child.BootstrapDialogue(m.conversation, dispatch.TurnID)
	child = next.(Model)
	if child.dialogueBootstrapResult.Error != "" || prepare == nil {
		t.Fatal("planning bootstrap failed", child.dialogueBootstrapResult)
	}
	var options RunOptions
	if json.Unmarshal(child.requests.Requests[0].Options, &options) != nil || !options.PlanFirst {
		t.Fatal("agent plan decision lost at child admission")
	}
	next, _ = child.Update(prepare())
	child = next.(Model)
	if child.requests.Requests[0].Plan.Phase != "review" || len(child.requests.Requests[0].Plan.Content.Questions) != 1 {
		t.Fatal("questions not retained for review")
	}
}

func TestDialogueRevalidatesTargetsAndRetainsUnconfirmedMessagesWithoutReplay(t *testing.T) {
	config, _ := dialogueConfig(t)
	stateDir := t.TempDir()
	store, err := worksession.Open(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	config.SessionStore = &store
	config.CreateConversation = func(source string) (worksession.Conversation, error) { return store.CreateChat(source, time.Now()) }
	config.LoadConversation = func(id string) (ConversationState, error) {
		c, err := store.Load(id)
		return ConversationState{Title: c.Title, SourcePath: c.SourcePath}, err
	}
	config.RouteConversation = func(_ context.Context, r workrun.ConversationRequest, _ ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "stop", Target: r.Tasks[0].ID}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	release, err := m.admitRun("Original task", m.submissionOptions())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	m.running = true
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.cancel = cancel
	m, cmd := dialogueSubmit(t, m, "stop-original-0001", "Stop that task")
	message := cmd()
	m.activeRequest = "another-task"
	next, _ := m.Update(message)
	m = next.(Model)
	if ctx.Err() != nil || m.dialogueTurns[0].State != "failed" {
		t.Fatal("changed target stopped unrelated work")
	}
	m, cmd = dialogueSubmit(t, m, "unconfirmed-message", "Hello again")
	if cmd == nil {
		t.Fatal("message not scheduled")
	}
	config.StartConversationID = m.conversation
	restored := New(config)
	if len(restored.dialogueQueue) != 0 || restored.dialogueDispatch != nil || restored.dialogueRouting != "" {
		t.Fatal("restored unconfirmed message was replayed")
	}
	// A damaged retained identity is an error, not permission for another Work admission.
	turn := m.dialogueTurns[len(m.dialogueTurns)-1]
	path := filepath.Join(stateDir, "hot-cross-buns", "conversations", m.conversation, "dialogue", fmt.Sprintf("%020d-%s.json", turn.Sequence, turn.ID))
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	next, _ = m.SubmitBridgeUploads(BridgeUploadSubmission{RequestID: "unconfirmed-message", Context: "conversation:" + m.conversation, Text: "Hello again"})
	if next.(Model).bridgeUploadResult.Error == "" {
		t.Fatal("corrupt admission was silently retried")
	}
}

type waitingDialogueModel struct{}

func (waitingDialogueModel) Complete(ctx context.Context, _ agent.TurnRequest) (agent.Turn, error) {
	<-ctx.Done()
	return agent.Turn{}, ctx.Err()
}

func TestDialogueRouteCancellationDoesNotCancelWork(t *testing.T) {
	config, _ := dialogueConfig(t)
	config.RouteConversation = func(ctx context.Context, _ workrun.ConversationRequest, _ ConversationInput) (workrun.ConversationDecision, error) {
		<-ctx.Done()
		return workrun.ConversationDecision{}, ctx.Err()
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.running = true
	workCtx, workCancel := context.WithCancel(context.Background())
	defer workCancel()
	m.cancel = workCancel
	m, cmd := dialogueSubmit(t, m, "cancel-router-0001", "Hello")
	m.dialogueCancel()
	value := cmd().(conversationRouted)
	if !errors.Is(value.Err, context.Canceled) || workCtx.Err() != nil {
		t.Fatal("conversation routing cancellation leaked into execution")
	}
	// Exercise a real workrun operation: a routing failure cannot grant approval
	// or redirect the independent operation's control channel.
	service := workrun.Service{Executor: workrun.Executor{Model: waitingDialogueModel{}, StateDir: t.TempDir()}}
	operation := service.Start(context.Background(), workrun.Request{SourcePath: t.TempDir(), Objective: "Compare", Mode: action.Inspect, Contract: artifact.InspectionContract()})
	defer func() {
		operation.Cancel()
		select {
		case <-operation.Done:
		case <-time.After(5 * time.Second):
			t.Error("operation did not finish cancellation")
		}
	}()
	m.operation = operation
	next, _ := m.Update(value)
	if next.(Model).operation != operation || next.(Model).dialogueTurns[0].State != "failed" {
		t.Fatal("failed response took ownership of Work")
	}
}

func TestRelatedFollowupReusesTaskAndKeepsEarlierResults(t *testing.T) {
	config, store := dialogueConfig(t)
	sequence := 0
	config.Run = func(_ string, chat, text string, _ RunOptions) RunResult {
		sequence++
		c, err := store.Load(chat)
		if err != nil {
			t.Fatal(err)
		}
		rev := fmt.Sprintf("rev-followup-%d", sequence)
		answer := fmt.Sprintf("Retained answer %d", sequence)
		_, err = store.AddRevision(chat, worksession.Revision{ID: rev, ParentRevisionID: c.HeadRevision, SnapshotID: "snap-test", Objective: text, BundlePath: "/fixture/bundle", Status: "completed", FinalText: answer})
		if err != nil {
			t.Fatal(err)
		}
		return RunResult{FinalText: answer, RevisionID: rev}
	}
	parent, err := store.CreateChat(config.CurrentFolder, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	config.StartConversationID = parent.ID
	config.PrimaryConversation = func() (string, error) { return parent.ID, nil }
	config.RouteConversation = func(_ context.Context, r workrun.ConversationRequest, _ ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "task"}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.options.MaxSteps = 12
	m.options.ConnectorIDs = []string{"original-account"}
	m, cmd := dialogueSubmit(t, m, "research-original-0001", "Research the 2025 Iran war")
	m = routeDialogue(t, m, cmd)
	if m.dialogueDispatch == nil {
		t.Fatalf("missing dispatch: %+v issue=%s", m.dialogueTurns, m.dialogueIssue)
	}
	dispatch := *m.dialogueDispatch
	childConfig := config
	childConfig.StartConversationID = dispatch.ChildID
	child := New(childConfig)
	child.background = true
	next, work := child.BootstrapDialogue(parent.ID, dispatch.TurnID)
	child = next.(Model)
	if work == nil {
		t.Fatal("original task did not start")
	}
	next, _ = child.Update(work())
	child = next.(Model)
	// The fixture runner completes through its ordinary work outcome command.
	for child.running {
		t.Fatal("fixture outcome did not finish")
	}
	next, _ = m.FinishDialogueDispatch(*child.dialogueBootstrapResult)
	m = next.(Model)
	peer := child.dialogueTaskState()
	if peer == nil || peer.State != "completed" {
		t.Fatalf("original state: %+v", peer)
	}
	m = m.ConfigureDialogueHost(DialogueHost{CanStart: true, Peers: []DialoguePeer{peer.DialoguePeer}})
	config.RouteConversation = func(_ context.Context, r workrun.ConversationRequest, _ ConversationInput) (workrun.ConversationDecision, error) {
		if len(r.Tasks) != 1 || !r.Tasks[0].CanContinue {
			t.Fatalf("no continuation capability: %+v", r.Tasks)
		}
		return workrun.ConversationDecision{Kind: "continue", Target: dispatch.ChildID}, nil
	}
	m.config.RouteConversation = config.RouteConversation
	m.options.MaxSteps = 48
	m.options.ConnectorIDs = []string{"broader-account"}
	m, cmd = dialogueSubmit(t, m, "research-followup-0002", "What about US intervention?")
	m = routeDialogue(t, m, cmd)
	follow := *m.dialogueDispatch
	if follow.ChildID != dispatch.ChildID || follow.TurnID == dispatch.TurnID {
		t.Fatal("followup did not reuse owner")
	}
	next, work = child.BootstrapDialogue(parent.ID, follow.TurnID)
	child = next.(Model)
	if work == nil {
		t.Fatalf("continuation not admitted: %+v", child.dialogueBootstrapResult)
	}
	if len(child.requests.Requests) != 2 || child.requests.Requests[1].Text != "What about US intervention?" {
		t.Fatal("followup text missing from task journal")
	}
	var frozen RunOptions
	if json.Unmarshal(child.requests.Requests[1].Options, &frozen) != nil || frozen.MaxSteps != 12 || len(frozen.ConnectorIDs) != 1 || frozen.ConnectorIDs[0] != "original-account" {
		t.Fatalf("continuation broadened its original scope: %+v", frozen)
	}
	next, _ = child.Update(work())
	child = next.(Model)
	if child.running {
		t.Fatal("followup did not complete")
	}
	if !store.DialogueTaskTurn(child.conversation, parent.ID, follow.TurnID) {
		t.Fatal("continuation provenance missing")
	}
	if state := child.dialogueTaskState(); state == nil || state.TurnID != follow.TurnID || state.State != "completed" {
		t.Fatalf("latest result not projected: %+v", state)
	}
	next, retry := child.BootstrapDialogue(parent.ID, follow.TurnID)
	child = next.(Model)
	if retry != nil || len(child.requests.Requests) != 2 {
		t.Fatal("continuation replayed")
	}
	if got := m.dialogueMessages(); len(got) != 2 || got[0].TaskResult == "" || got[1].TaskResult == "" {
		t.Fatalf("per-turn results lost: %+v", got)
	}
	page, err := store.PageConversations(worksession.ConversationQuery{TaskParent: parent.ID, Text: "US intervention", Content: true})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != child.conversation {
		t.Fatalf("task search missing: %+v %v", page, err)
	}
	other, _ := store.CreateChat(config.CurrentFolder, time.Now())
	// Opening this secondary conversation and replying uses its existing owner.
	child.primaryID = parent.ID
	child, direct := dialogueSubmit(t, child, "direct-task-reply-0003", "Explain the ceasefire talks")
	if direct == nil || len(child.requests.Requests) != 3 || len(child.dialogueTurns) != 0 {
		t.Fatal("direct task reply created another conversation")
	}
	if state := child.dialogueTaskState(); state == nil || state.State != "running" || state.CanGuide || state.CanStop {
		t.Fatalf("direct reply projected a stale completed task or parent control: %+v", state)
	}
	if store.DialogueTaskTurn(child.conversation, other.ID, follow.TurnID) {
		t.Fatal("unrelated parent accepted")
	}
}
