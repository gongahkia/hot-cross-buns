package workapp

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
	"testing"
)

func TestBridgeCorrectionCapabilitiesFollowOriginalOwnerReadiness(t *testing.T) {
	config, _ := dialogueConfig(t)
	config.PreparePlan = func(context.Context, worksession.Request) (worksession.PlanContent, error) {
		return dialoguePlanContent(), nil
	}
	config.RevisePlan = func(context.Context, worksession.Request) (worksession.PlanContent, error) {
		t.Fatal("display projection prepared work")
		return worksession.PlanContent{}, nil
	}
	m := New(config).FocusBridgeSession(true).ConfigureDialogueHost(DialogueHost{CanStart: true})
	next, prepare := m.SubmitBridgeUploads(BridgeUploadSubmission{RequestID: "bridge-plan-capability", Context: "conversation:" + m.conversation, Text: "Compare my notes", PlanFirst: true})
	m = next.(Model)
	if prepare == nil {
		t.Fatal("no preparation fixture")
	}
	next, _ = m.Update(prepare())
	m = next.(Model)
	state := m.BridgeState()
	if len(state.CanRevisePlans) != 1 || state.CanRevisePlans[0] != state.TaskPlans[0].ID || state.CanCorrectAction {
		t.Fatal("wrong capabilities", state.CanRevisePlans, state.CanCorrectAction)
	}
	m = m.ConfigureDialogueHost(DialogueHost{CanStart: false})
	if len(m.BridgeState().CanRevisePlans) != 0 {
		t.Fatal("capacity-blocked owner advertised revision")
	}
	if m.requests.Requests[0].Plan.Approval != nil {
		t.Fatal("display granted approval")
	}
}
