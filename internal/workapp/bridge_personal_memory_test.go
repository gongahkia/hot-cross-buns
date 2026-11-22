package workapp

import (
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"testing"
)

func TestPersonalMemoryBridgeBindsPendingResultAndRequiresManagedHost(t *testing.T) {
	calls := 0
	cfg := Config{ManagedSessions: true, PersonalMemory: func(action personalization.CatalogAction) personalization.CatalogResult {
		calls++
		return personalization.CatalogResult{RequestID: action.RequestID, Catalog: &personalization.Catalog{}}
	}}
	model := New(cfg)
	next, command := model.ApplyPersonalMemory(personalization.CatalogAction{Action: "list", RequestID: "request-one"})
	if command == nil {
		t.Fatal("no catalog command")
	}
	model = next.(Model)
	ignored, _ := model.finishPersonalMemory(personalization.CatalogResult{RequestID: "different"})
	if ignored.(Model).personalMemoryPending != "request-one" {
		t.Fatal("unrelated result cleared request")
	}
	done, err := model.Update(command())
	_ = err
	model = done.(Model)
	if calls != 1 || model.BridgeState().PersonalMemoryResult.RequestID != "request-one" {
		t.Fatal("result not projected")
	}
	unmanaged := New(Config{PersonalMemory: cfg.PersonalMemory})
	_, command = unmanaged.ApplyPersonalMemory(personalization.CatalogAction{RequestID: "request-two", Action: "list"})
	if command != nil || calls != 1 {
		t.Fatal("unmanaged caller reached memory")
	}
}
