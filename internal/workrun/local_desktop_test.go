package workrun

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/desktop"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
)

type localAXRuntime struct {
	desktop.Runtime
	actions int
}

func (*localAXRuntime) AccessibilityTrusted() (bool, error) { return true, nil }
func (*localAXRuntime) FrontWindow(context.Context) (desktop.Window, error) {
	return desktop.Window{Application: desktop.Application{BundleID: "dev.hcb.fixture"}, ID: 1, PID: 10, Width: 500, Height: 300}, nil
}
func (*localAXRuntime) Activate(context.Context, string) error { return nil }
func (r *localAXRuntime) ReadAccessibility(context.Context, desktop.Window) (desktop.AccessibilityTree, error) {
	label := "Ready"
	if r.actions > 0 {
		label = "Done"
	}
	return desktop.AccessibilityTree{Title: "Fixture", Elements: []desktop.AccessibilityElement{{Role: "AXButton", Label: label, Enabled: true, Actions: []string{"press"}}}}, nil
}
func (r *localAXRuntime) PerformAccessibility(context.Context, desktop.Window, desktop.AccessibilityTree, desktop.AccessibilityElement, string, string) error {
	r.actions++
	return nil
}

type localDesktopModel struct {
	t              *testing.T
	turn           int
	verified       bool
	attemptedEarly bool
}

func (*localDesktopModel) SupportsVisualInput() bool { return false }
func (m *localDesktopModel) Complete(_ context.Context, request agent.TurnRequest) (agent.Turn, error) {
	m.turn++
	call := func(name string, args any) agent.Turn {
		raw, _ := json.Marshal(args)
		return agent.Turn{ToolCalls: []agent.ToolCall{{ID: name, Name: name, Arguments: raw}}}
	}
	if m.turn == 1 {
		found := false
		for _, tool := range request.Tools {
			if tool.Name == "desktop_snapshot" {
				found = true
			}
			if tool.Name == "computer_action" || tool.Name == "desktop_screenshot" || tool.Name == "desktop_type" {
				m.t.Fatal("text model received visual/global input")
			}
		}
		if !found {
			m.t.Fatal("no desktop tools")
		}
		return call("desktop_snapshot", map[string]string{}), nil
	}
	if m.turn == 2 {
		last := request.Messages[len(request.Messages)-1].Content
		start := strings.Index(last, `"snapshot_id"`)
		if start < 0 {
			m.t.Fatal(last)
		}
		var payload map[string]any
		// tool success results are JSON envelopes.
		if err := json.Unmarshal([]byte(last), &payload); err != nil {
			m.t.Fatal(err)
		}
		raw, _ := json.Marshal(payload)
		var snapshotID string
		var walk func(any)
		walk = func(value any) {
			if obj, ok := value.(map[string]any); ok {
				if id, ok := obj["snapshot_id"].(string); ok {
					snapshotID = id
				}
				for _, child := range obj {
					walk(child)
				}
			}
		}
		walk(payload)
		if snapshotID == "" {
			m.t.Fatal(string(raw))
		}
		return call("desktop_action", map[string]string{"snapshot_id": snapshotID, "ref": "e1", "action": "press"}), nil
	}
	if m.turn == 3 {
		m.attemptedEarly = true
		return agent.Turn{Text: "Done."}, nil
	}
	if m.turn == 4 {
		return call("desktop_snapshot", map[string]string{}), nil
	}
	m.verified = strings.Contains(request.Messages[len(request.Messages)-1].Content, "Done")
	return agent.Turn{Text: "The approved button now reads Done."}, nil
}
func TestTextOnlyLocalDesktopRequiresReviewAndPostActionRead(t *testing.T) {
	state := t.TempDir()
	store, _ := desktop.Open(state)
	session, err := store.Start(desktop.StartOptions{Apps: []desktop.Application{{BundleID: "dev.hcb.fixture"}}})
	if err != nil {
		t.Fatal(err)
	}
	runtime := &localAXRuntime{}
	controller, _ := desktop.NewController(store, runtime)
	model := &localDesktopModel{t: t}
	reviews := 0
	out, err := (Executor{Model: model, Desktop: controller, StateDir: state}).Execute(context.Background(), Request{Provider: "hot-cross-buns-local/test", SourcePath: t.TempDir(), Objective: "Press the approved button", Mode: action.Inspect, Contract: artifact.InspectionContract(), DisableDelegation: true, DesktopSession: session.ID, DesktopPolicy: desktop.PolicyDigest(session), MaxSteps: 8, ApproveDesktop: func(context.Context, []string) (tools.CommandDecision, error) {
		reviews++
		return tools.CommandAllowOnce, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if reviews != 1 || runtime.actions != 1 || !model.verified || !model.attemptedEarly || !strings.Contains(out.Result.FinalText, "Done") {
		t.Fatalf("reviews=%d actions=%d model=%+v final=%s", reviews, runtime.actions, model, out.Result.FinalText)
	}
}
