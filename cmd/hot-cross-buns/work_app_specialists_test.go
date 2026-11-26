package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestSpecialistAssignmentsAreReviewedFutureScopeAndRejectStaleChanges(t *testing.T) {
	c := appControllerForTest(t)
	if err := c.settings.Update(func(s *config.Settings) error {
		s.CustomProviders = []config.CustomProvider{{ID: "local-fixture", BaseURL: "http://127.0.0.1:11434/v1", Models: []string{"reader"}, DefaultModel: "reader"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	change := workrun.AppChange{Setting: "specialist_model", Value: json.RawMessage(`{"role":"source_researcher","provider":"local-fixture","model":"reader","max_steps":6}`)}
	prepared, err := c.Prepare(context.Background(), change)
	if err != nil {
		t.Fatal(err)
	}
	if !prepared.Review || !prepared.AfterRun {
		t.Fatal("assignment lacks review or changes active work")
	}
	before, _ := c.settings.Load()
	if len(before.WorkRoles) != 0 {
		t.Fatal("prepare mutated assignments")
	}
	if _, err = prepared.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := c.settings.Load()
	if len(after.WorkRoles) != 1 || after.WorkRoles[0].Model != "reader" || after.Defaults != before.Defaults {
		t.Fatal("assignment changed orchestrator or failed")
	}
	if _, err = prepared.Apply(context.Background()); err == nil {
		t.Fatal("stale assignment applied")
	}
	change.Value = json.RawMessage(`{"role":"code","provider":"openai","model":"gpt-5-mini","max_steps":6}`)
	if _, err = c.Prepare(context.Background(), change); err == nil {
		t.Fatal("native assignment changed CLI coding configuration")
	}
}

func TestNativeSpecialistModelReviewIsExactAndSingleUse(t *testing.T) {
	b := nativeProviderFixture(t)
	_ = b.settings.Update(func(s *config.Settings) error { s.RememberOrchestratorModel("openai", "gpt-5-mini"); return nil })
	review := b.Apply(modelcatalog.NativeProviderAction{RequestID: "review", Action: "specialist_review", Role: "claim_verifier", Provider: "openai", ModelID: "gpt-5-mini", MaxSteps: 5})
	if review.Error != "" || review.Review == nil || review.Review.Role != "claim_verifier" {
		t.Fatalf("review: %#v", review)
	}
	settings, _ := b.settings.Load()
	if len(settings.WorkRoles) != 0 {
		t.Fatal("review changed config")
	}
	saved := b.Apply(modelcatalog.NativeProviderAction{RequestID: "save", Action: "specialist_save", ReviewID: review.Review.ID})
	if saved.Error != "" || !saved.Confirmed {
		t.Fatalf("save: %#v", saved)
	}
	if b.Apply(modelcatalog.NativeProviderAction{RequestID: "replay", Action: "specialist_save", ReviewID: review.Review.ID}).Confirmed {
		t.Fatal("review reused")
	}
	review = b.Apply(modelcatalog.NativeProviderAction{RequestID: "review2", Action: "specialist_review", Role: "claim_verifier", Inherit: true, MaxSteps: 4})
	if review.Review == nil {
		t.Fatal(review.Error)
	}
	_ = b.settings.Update(func(s *config.Settings) error { s.WorkRoles[0].MaxSteps = 6; return nil })
	if b.Apply(modelcatalog.NativeProviderAction{RequestID: "stale", Action: "specialist_save", ReviewID: review.Review.ID}).Confirmed {
		t.Fatal("concurrent assignment overwritten")
	}
}
