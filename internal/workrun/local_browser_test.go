package workrun

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/browser"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
)

type textBrowser struct {
	browser.UnavailableController
	clicks int
}

func (*textBrowser) Session(context.Context, string) (browser.Session, error) {
	return browser.Session{ID: "browser-local", State: browser.StateRunning, SelectedTabs: []browser.Tab{{ID: "tab-1", URL: "https://example.test/project"}}}, nil
}
func (*textBrowser) Snapshot(_ context.Context, _ string, tab string) (browser.Snapshot, error) {
	return browser.Snapshot{TabID: tab, URL: "https://example.test/project", Text: "Project owner Mira. Deadline 2030-05-16."}, nil
}
func (b *textBrowser) Click(context.Context, string, string, string) (browser.Snapshot, error) {
	b.clicks++
	return browser.Snapshot{TabID: "tab-1", Text: "Confirmed"}, nil
}

func TestTextOnlyLocalModelUsesGrantedBrowserAndRetainsFreshMutationReviews(t *testing.T) {
	for _, allow := range []bool{false, true} {
		t.Run(map[bool]string{false: "denied", true: "approved"}[allow], func(t *testing.T) {
			model := textOnlyScriptedModel{&scriptedModel{turns: []agent.Turn{
				{ToolCalls: []agent.ToolCall{{ID: "read", Name: "browser_snapshot", Arguments: json.RawMessage(`{"tab_id":"tab-1"}`)}}},
				{ToolCalls: []agent.ToolCall{{ID: "click", Name: "browser_click", Arguments: json.RawMessage(`{"tab_id":"tab-1","ref":"e1"}`)}}},
				{Text: "The selected project belongs to Mira and is due 2030-05-16."},
			}}}
			controller := &textBrowser{}
			reviews := 0
			out, err := (Executor{Model: model, Browser: controller, StateDir: t.TempDir()}).Execute(context.Background(), Request{Provider: "hot-cross-buns-local/qwen3:4b", SourcePath: t.TempDir(), Objective: "Read the selected project page", Mode: action.Inspect, Contract: artifact.InspectionContract(), BrowserSession: "browser-local", DisableDelegation: true, MaxSteps: 4, ApproveBrowser: func(context.Context, []string) (tools.CommandDecision, error) {
				reviews++
				if allow {
					return tools.CommandAllowOnce, nil
				}
				return tools.CommandDeny, nil
			}})
			if err != nil || !strings.Contains(out.Result.FinalText, "Mira") {
				t.Fatal(out.Result.FinalText, err)
			}
			if reviews != 1 || controller.clicks != map[bool]int{false: 0, true: 1}[allow] {
				t.Fatal("mutation bypassed review", reviews, controller.clicks)
			}
			for _, definition := range model.requests[0].Tools {
				if definition.Name == "browser_screenshot" {
					t.Fatal("text model received screenshot tool")
				}
			}
			if !strings.Contains(model.requests[1].Messages[len(model.requests[1].Messages)-1].Content, "2030-05-16") {
				t.Fatal("snapshot did not reach local model")
			}
		})
	}
}

func TestExplicitBrowserOptOutStillRejectsGrantedSession(t *testing.T) {
	_, err := (Executor{Model: textOnlyScriptedModel{&scriptedModel{}}, Browser: &textBrowser{}, StateDir: t.TempDir()}).Execute(context.Background(), Request{SourcePath: t.TempDir(), Objective: "Read selected page", Mode: action.Inspect, Contract: artifact.InspectionContract(), BrowserSession: "browser-local", DisableBrowser: true})
	if err == nil || !strings.Contains(err.Error(), "disabled for this request") {
		t.Fatal("explicit browser restriction ignored", err)
	}
}
