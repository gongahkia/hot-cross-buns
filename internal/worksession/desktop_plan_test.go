package worksession

import "testing"

func TestDesktopPlanEffectRetainsAllExistingScopes(t *testing.T) {
	content := PlanContent{Outcome: "Review and update approved apps", Steps: []PlanStep{{ID: "check", Text: "Inspect approved app controls"}}, Effects: []string{"read", "draft", "code", "checks", "connected_write", "settings", "browser", "desktop"}}
	if err := content.Validate(nil); err != nil {
		t.Fatal(err)
	}
	content.Effects = append(content.Effects, "unknown")
	if err := content.Validate(nil); err == nil {
		t.Fatal("unknown effect accepted")
	}
}
