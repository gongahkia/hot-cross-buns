package workrun

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"strings"
	"testing"
)

type scheduleControllerFixture struct{ calls int }

func (f *scheduleControllerFixture) Inspect(context.Context, AppQuery) (any, error) { return nil, nil }
func (f *scheduleControllerFixture) Prepare(context.Context, AppChange) (AppMutation, error) {
	return AppMutation{Review: true, ScheduleReview: &scheduleaccess.Review{Action: "create", Title: "Water plants"}, ApplySchedule: func(_ context.Context, choice string) (any, error) { f.calls++; return choice, nil }}, nil
}
func TestScheduleToolRequiresTypedReviewAndRejectsBroaderPermissionChoices(t *testing.T) {
	for _, choice := range []string{"missing", "deny", "once", "always", "full"} {
		t.Run(choice, func(t *testing.T) {
			f := &scheduleControllerFixture{}
			r := Request{ForegroundApp: true}
			if choice != "missing" {
				r.ApproveScheduleChange = func(context.Context, scheduleaccess.Review) (string, error) { return choice, nil }
			}
			result, err := applicationTools(f, r)[1].Execute(context.Background(), json.RawMessage(`{"setting":"schedule","value":{"action":"create"}}`))
			if choice == "once" || choice == "always" {
				if err != nil || f.calls != 1 || !strings.Contains(result.Content, `"status":"applied"`) {
					t.Fatal(result, err, f.calls)
				}
			} else if choice == "deny" {
				if err != nil || f.calls != 0 || !strings.Contains(result.Content, "declined") {
					t.Fatal(result, err, f.calls)
				}
			} else if err == nil || f.calls != 0 {
				t.Fatal("missing/invalid scheduling choice applied", err, f.calls)
			}
		})
	}
}
