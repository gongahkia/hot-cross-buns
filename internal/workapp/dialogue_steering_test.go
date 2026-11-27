package workapp

import (
	"context"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestPreferredSteeringUsesCapturedLiveScopeAndRequiresUnambiguousTarget(t *testing.T) {
	a := workrun.ConversationTask{ID: "one", State: "running", CanGuide: true, CanStop: true}
	b := workrun.ConversationTask{ID: "two", State: "running", CanGuide: true, CanStop: true}
	input := ConversationInput{PreferSteering: true, TaskContext: []workrun.ConversationTask{a, b}}
	r := workrun.ConversationRequest{Text: "Focus on the permissions boundary", Tasks: []workrun.ConversationTask{a}}
	decision, ok := preferredSteering(r, input, "")
	if !ok || decision.Kind != "guide" || decision.Target != a.ID || decision.Instruction != r.Text {
		t.Fatal("ordinary follow-up did not become steering", decision)
	}
	r.Tasks = []workrun.ConversationTask{a, b}
	decision, _ = preferredSteering(r, input, "")
	if decision.Kind != "clarify" {
		t.Fatal("ambiguous workers were guessed", decision)
	}
	decision, _ = preferredSteering(r, input, b.ID)
	if decision.Target != b.ID {
		t.Fatal("foreground task did not own its composer", decision)
	}
	r.ReplyToTaskID = a.ID
	decision, _ = preferredSteering(r, input, "")
	if decision.Target != a.ID {
		t.Fatal("explicit task reply was not respected", decision)
	}
	r.ReplyToTaskID = ""
	r.Tasks = []workrun.ConversationTask{{ID: "different", State: "running", CanGuide: true}}
	decision, _ = preferredSteering(r, input, "")
	if decision.Kind != "clarify" {
		t.Fatal("a replacement run received old input", decision)
	}
	r.Tasks = []workrun.ConversationTask{{ID: a.ID, State: "waiting for review", CanCorrectAction: true}}
	decision, _ = preferredSteering(r, input, "")
	if decision.Kind != "clarify" {
		t.Fatal("steering bypassed exact review", decision)
	}
	for _, scoped := range []workrun.ConversationRequest{{HasFiles: true}, {PlanFirst: true}} {
		if _, handled := preferredSteering(scoped, input, ""); handled {
			t.Fatal("new scope became live steering")
		}
	}
	r.Tasks, r.Text = []workrun.ConversationTask{a}, strings.Repeat("x", 64*1024+1)
	decision, _ = preferredSteering(r, input, "")
	if decision.Kind != "clarify" {
		t.Fatal("oversized steering was admitted")
	}
}

func TestComposerStopCancelsOnlyTheCapturedRunOrRouting(t *testing.T) {
	config, _ := dialogueConfig(t)
	config.RouteConversation = func(ctx context.Context, _ workrun.ConversationRequest, _ ConversationInput) (workrun.ConversationDecision, error) {
		<-ctx.Done()
		return workrun.ConversationDecision{}, ctx.Err()
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.primary = true
	m, command := dialogueSubmit(t, m, "stop-preparation", "Inspect the project")
	id := m.BridgeState().StopID
	if len(id) != 64 {
		t.Fatal("preparation had no stop capability")
	}
	next, _ := m.ApplyBridgeQueue(BridgeQueueAction{RequestID: "stop", ID: id, Action: "stop"})
	m = next.(Model)
	if m.bridgeQueueResult.Error != "" || m.dialogueRouting != "" || m.BridgeState().StopID != "" || m.dialogueTurns[0].State != "interrupted" {
		t.Fatal("preparation did not stop and retain its message")
	}
	next, _ = m.Update(command())
	m = next.(Model)
	if m.dialogueTurns[0].State != "interrupted" {
		t.Fatal("a late completion revived stopped routing")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.running, m.cancel, m.activeRequest = true, cancel, "new-task"
	next, _ = m.ApplyBridgeQueue(BridgeQueueAction{RequestID: "stale-stop", ID: id, Action: "stop"})
	m = next.(Model)
	if m.bridgeQueueResult.Error == "" || ctx.Err() != nil {
		t.Fatal("stale stop cancelled replacement work")
	}
	next, _ = m.ApplyBridgeQueue(BridgeQueueAction{RequestID: "current-stop", ID: m.bridgeStopID(), Action: "stop"})
	m = next.(Model)
	if m.bridgeQueueResult.Error != "" || ctx.Err() == nil || !m.cancelling {
		t.Fatal("current stop was not applied")
	}
}
