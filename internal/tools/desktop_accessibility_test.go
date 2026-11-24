package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/desktop"
)

type toolAXRuntime struct {
	desktop.Runtime
	actions int
}

func (*toolAXRuntime) AccessibilityTrusted() (bool, error) { return true, nil }
func (*toolAXRuntime) FrontWindow(context.Context) (desktop.Window, error) {
	return desktop.Window{Application: desktop.Application{BundleID: "dev.hcb.fixture"}, ID: 1, PID: 10, Width: 500, Height: 300}, nil
}
func (*toolAXRuntime) Activate(context.Context, string) error { return nil }
func (*toolAXRuntime) ReadAccessibility(context.Context, desktop.Window) (desktop.AccessibilityTree, error) {
	return desktop.AccessibilityTree{Title: "Draft", Elements: []desktop.AccessibilityElement{{Role: "AXTextField", Label: "Message", Enabled: true, Actions: []string{"set_value"}}}}, nil
}
func (r *toolAXRuntime) PerformAccessibility(context.Context, desktop.Window, desktop.AccessibilityTree, desktop.AccessibilityElement, string, string) error {
	r.actions++
	return nil
}
func TestDesktopAccessibilityActionsAlwaysReviewFullReplacement(t *testing.T) {
	for _, decision := range []CommandDecision{CommandDeny, CommandAllowAlways, CommandAllowOnce} {
		t.Run(decision.String(), func(t *testing.T) {
			ctx := context.Background()
			store, _ := desktop.Open(t.TempDir())
			session, _ := store.Start(desktop.StartOptions{Apps: []desktop.Application{{BundleID: "dev.hcb.fixture"}}})
			runtime := &toolAXRuntime{}
			controller, _ := desktop.NewController(store, runtime)
			snapshot, err := controller.AccessibilitySnapshot(ctx, session.ID)
			if err != nil {
				t.Fatal(err)
			}
			replacement := strings.Repeat("a", 2048) + "TAIL"
			reviews := 0
			tools := DesktopAccessibilityTools(DesktopSessionOptions{SessionID: session.ID, Controller: controller, Policy: CommandPolicy{Approve: func(_ context.Context, argv []string) (CommandDecision, error) {
				reviews++
				if !strings.Contains(argv[3], replacement) {
					t.Fatal("review concealed replacement")
				}
				return decision, nil
			}}})
			for _, tool := range tools {
				if strings.Contains(tool.Definition().Name, "screenshot") || tool.Definition().Name == "desktop_type" {
					t.Fatal("visual/global input leaked")
				}
			}
			raw, _ := json.Marshal(map[string]string{"snapshot_id": snapshot.ID, "ref": "e1", "action": "set_value", "value": replacement})
			_, err = tools[1].Execute(ctx, raw)
			if reviews != 1 || (err == nil) != (decision == CommandAllowOnce) {
				t.Fatal(reviews, err)
			}
			expected := 0
			if decision == CommandAllowOnce {
				expected = 1
			}
			if runtime.actions != expected {
				t.Fatal("action escaped fresh review")
			}
		})
	}
}
func TestDesktopAccessibilityMissingValueNeverReviews(t *testing.T) {
	store, _ := desktop.Open(t.TempDir())
	controller, _ := desktop.NewController(store, &toolAXRuntime{})
	tool := desktopActionTool{desktopSessionTool{sessionID: "desktop-fixture", controller: controller, policy: CommandPolicy{Approve: func(context.Context, []string) (CommandDecision, error) {
		t.Fatal("invalid action requested review")
		return CommandAllowOnce, nil
	}}}}
	if _, err := tool.Execute(context.Background(), json.RawMessage(`{"action":"set_value","ref":"e1"}`)); err == nil {
		t.Fatal("missing replacement accepted")
	}
}
