package workapp

import (
	"github.com/gongahkia/gator/internal/modelcatalog"
	"github.com/gongahkia/gator/internal/workrun"
	"reflect"
	"strings"
	"testing"
)

func TestNativeLocalInspectionPreservesExactPendingApprovalAndRejectsLateResult(t *testing.T) {
	calls := 0
	m := New(Config{ManagedSessions: true, NativeProviders: func(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
		calls++
		return modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action, Local: &modelcatalog.NativeLocalStatus{ResultID: "observed"}}
	}})
	m.interaction = &workrun.Interaction{ID: 17, Kind: "inert-test"}
	m.messages = append(m.messages, approvalMessage(*m.interaction))
	before := m.BridgeState().PendingApproval
	if before == nil || before.Token == "" {
		t.Fatal("missing exact pending review")
	}
	next, cmd := m.ApplyNativeProvider(modelcatalog.NativeProviderAction{RequestID: "read-local", Action: "local_status"})
	m = next.(Model)
	if cmd == nil || calls != 0 {
		t.Fatal("status not admitted as finite command")
	}
	// A delayed result from another request cannot replace this read.
	next, _ = m.finishNativeProvider(modelcatalog.NativeProviderResult{RequestID: "old-local", Action: "local_status"})
	m = next.(Model)
	if m.nativeProviderResult != nil || m.nativeProviderPending != "read-local" {
		t.Fatal("late result changed current request")
	}
	next, _ = m.Update(cmd())
	m = next.(Model)
	if calls != 1 || m.nativeProviderPending != "" || m.nativeProviderResult.Local.ResultID != "observed" {
		t.Fatal("missing exact completion")
	}
	if !reflect.DeepEqual(before, m.BridgeState().PendingApproval) || m.interaction == nil {
		t.Fatal("local observation altered canonical pending approval")
	}
	next, again := m.ApplyNativeProvider(modelcatalog.NativeProviderAction{RequestID: "read-local", Action: "local_status"})
	m = next.(Model)
	if again != nil || calls != 1 || !reflect.DeepEqual(before, m.BridgeState().PendingApproval) {
		t.Fatal("duplicate read caused replay or approval change")
	}
}

func TestManagedNativeDoesNotExposeLegacyModelLifecyclePanel(t *testing.T) {
	called := false
	m := New(Config{ManagedSessions: true, Models: func() (ModelPanel, error) { called = true; return nil, nil }})
	next, cmd := m.openModels()
	m = next.(Model)
	if called || cmd != nil || m.models != nil || !strings.Contains(m.status, "Models and Providers") {
		t.Fatal("unreviewed legacy local lifecycle exposed to native host")
	}
}

func TestNativeLocalSelectionFutureRefreshPreservesExactApproval(t *testing.T) {
	m := New(Config{ManagedSessions: true, SelectedModel: func() (string, string, error) { return "gator-local", "qwen3:4b", nil }, NativeProviders: func(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
		return modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action, Confirmed: true, Changed: true}
	}})
	m.interaction = &workrun.Interaction{ID: 44, Kind: "inert-test"}
	m.messages = append(m.messages, approvalMessage(*m.interaction))
	pending := m.BridgeState().PendingApproval
	next, cmd := m.ApplyNativeProvider(modelcatalog.NativeProviderAction{RequestID: "future-selection", Action: "local_select"})
	m = next.(Model)
	next, _ = m.Update(cmd())
	m = next.(Model)
	if !reflect.DeepEqual(pending, m.BridgeState().PendingApproval) {
		t.Fatal("future selection changed exact approval identity")
	}
}
