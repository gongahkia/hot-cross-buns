package workrun

import (
	"context"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
)

func TestScheduledRoutineRunsExactProcedureAndRejectsRevisionChange(t *testing.T) {
	state := t.TempDir()
	store, _ := knowledge.Open(state)
	skill, err := store.AddSkillWithRoutine("brief", "Brief", "Read {{topic}} and report.", &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Subject"}}, Effects: []string{"read"}, MaxRequests: 4, MaxTokens: 8000})
	if err != nil {
		t.Fatal(err)
	}
	reference := &RoutineReference{Name: skill.ID, Revision: skill.Revision(), Parameters: map[string]string{"topic": "Garden"}}
	model := &scriptedModel{turns: []agent.Turn{{Text: "The garden needs attention."}}}
	request := Request{StateDir: state, SourcePath: t.TempDir(), Objective: "Use the reviewed garden routine", ScheduledJobID: "job-fixture", ScheduledJobPolicy: strings.Repeat("a", 64), ScheduledRoutine: reference, Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 4, DisableDelegation: true}
	_, err = (Executor{StateDir: state, Model: model}).Execute(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(model.requests) != 1 || !strings.Contains(model.requests[0].System, "Read Garden and report.") {
		t.Fatal("approved procedure absent")
	}
	for _, tool := range model.requests[0].Tools {
		if tool.Name == "skill_prepare" || tool.Name == "desktop_action" {
			t.Fatal("unattended routine gained a foreground tool")
		}
	}
	if _, err := store.SetSkillEnabled(skill.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = (Executor{StateDir: state, Model: model}).Execute(context.Background(), request); err == nil {
		t.Fatal("disabled routine still executes")
	}
}

func TestScheduledReadScopesOnlyNarrowExistingPermissions(t *testing.T) {
	d := connector.Descriptor{Version: 1, ID: "mail", Name: "Mail", Kind: connector.KindSlack, Resource: "https://slack.com", Authentication: connector.AuthNone}
	registry, err := connector.NewRegistry([]connector.Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	r := Request{ScheduledJobID: "job-fixture", ScheduledJobPolicy: strings.Repeat("a", 64), ConnectorIDs: []string{"mail"}, ScheduledReads: map[string][]string{"mail": {"history"}}}
	p := scheduledConnectorPermissions(registry, r)
	if p.Resolve("mail", "history", action.ConnectedRead) != connector.PermissionAllow || p.Resolve("mail", "search", action.ConnectedRead) != connector.PermissionDeny {
		t.Fatal("scope did not narrow reads")
	}
	r.ConnectorPermissions = connector.PermissionSet{{ConnectorID: "mail", Operation: "history", Read: connector.PermissionDeny}}
	if scheduledConnectorPermissions(registry, r).Resolve("mail", "history", action.ConnectedRead) != connector.PermissionDeny {
		t.Fatal("revoked access was restored by scheduling")
	}
}
