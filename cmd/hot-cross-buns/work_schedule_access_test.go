package main

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"testing"
)

func TestScheduledAccessRequiresExactReviewAndRejectsChangedBinding(t *testing.T) {
	c := followupControllerForTest(t)
	c.request.RunID = "scheduled-read"
	c.request.ConnectorIDs = []string{"reports"}
	if err := c.settings.Update(func(s *config.Settings) error {
		s.Connectors = []connector.Descriptor{{Version: 1, ID: "reports", Name: "Reports", Kind: connector.KindHTTPJSON, Resource: "https://example.invalid/reports", Authentication: connector.AuthNone}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	policy, _ := scheduleaccess.Open(c.stateDir)
	current, _ := policy.Get()
	if _, err := policy.Set(current.Revision, true); err != nil {
		t.Fatal(err)
	}
	value := createScheduleValue()
	value["connector_ids"] = []string{"reports"}
	value["read_operations"] = map[string][]string{"reports": {"fetch"}}
	m, err := c.Prepare(context.Background(), scheduleToolChange(c, value))
	if err != nil {
		t.Fatal(err)
	}
	if !m.Review {
		t.Fatal("always scheduling bypassed new account scope review")
	}
	if err := c.settings.Update(func(s *config.Settings) error {
		s.Connectors[0].Resource = "https://example.invalid/changed"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ApplySchedule(context.Background(), "once"); err == nil {
		t.Fatal("changed source accepted under an old approval")
	}
	d := requireSchedule(t, c, value, "once")
	request := jobWorkRequest(d)
	if request.ForegroundApp {
		t.Fatal("scheduled task inherited foreground authority")
	}
	if len(request.ConnectorIDs) != 1 || request.CredentialPins["reports"] == "" || len(request.ScheduledReads["reports"]) != 1 {
		t.Fatal("reviewed access lost during execution preparation")
	}
	value["read_operations"] = map[string][]string{"reports": {"publish"}}
	if _, err := c.Prepare(context.Background(), scheduleToolChange(c, value)); err == nil {
		t.Fatal("scheduled write accepted as a read")
	}
}

func TestScheduledRoutinePinsAnEnabledReadDraftRevision(t *testing.T) {
	c := followupControllerForTest(t)
	c.request.RunID = "scheduled-routine"
	store, _ := knowledge.Open(c.stateDir)
	skill, err := store.AddSkillWithRoutine("brief", "Brief", "Read {{topic}} and report.", &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Subject"}}, Effects: []string{"read"}, MaxRequests: 4, MaxTokens: 8000})
	if err != nil {
		t.Fatal(err)
	}
	value := createScheduleValue()
	value["routine"] = map[string]any{"name": skill.ID, "revision": skill.Revision(), "parameters": map[string]string{"topic": "Gardening"}}
	d := requireSchedule(t, c, value, "once")
	if d.Routine == nil || d.Routine.Revision != skill.Revision() {
		t.Fatal("routine revision not retained")
	}
	if _, err := store.UpdateSkill(skill.ID, "Changed", "Read {{topic}} and report updated facts."); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Prepare(context.Background(), scheduleToolChange(c, value)); err == nil {
		t.Fatal("changed procedure was scheduled using old consent")
	}
}
