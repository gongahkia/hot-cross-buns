package workrun

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestFilesystemPlanSurfaceAndExactMutationScope(t *testing.T) {
	tool := tools.Filesystem{}
	for _, effects := range [][]string{{"read"}, {"filesystem"}, {"read", "filesystem"}} {
		request := Request{reviewedPlan: &worksession.TaskPlan{Content: &worksession.PlanContent{Effects: effects}}}
		if len(filterTaskPlanTools(request, []agent.Tool{tool})) != 1 {
			t.Fatalf("filesystem hidden from reviewed scope %v", effects)
		}
	}
	if len(filterTaskPlanTools(Request{reviewedPlan: &worksession.TaskPlan{Content: &worksession.PlanContent{Effects: []string{"draft"}}}}, []agent.Tool{tool})) != 0 {
		t.Fatal("unrelated plan exposed live files")
	}
	_, _, request := claimedPlanFixture(t, []string{"read"})
	plan, err := loadReviewedTaskPlan(request)
	if err != nil {
		t.Fatal(err)
	}
	request.reviewedPlan = plan
	check := taskPlanToolCheck(request, []agent.Tool{tool})
	if err := check(context.Background(), agent.ToolCall{Name: "filesystem", Arguments: json.RawMessage(`{"operation":"read"}`)}); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`{"operation":"write"}`, `{"operation":"delete"}`, `{"operation":"request_access","access":"write"}`} {
		if err := check(context.Background(), agent.ToolCall{Name: "filesystem", Arguments: json.RawMessage(raw)}); err == nil {
			t.Fatal("read plan admitted live mutation", raw)
		}
	}
}
