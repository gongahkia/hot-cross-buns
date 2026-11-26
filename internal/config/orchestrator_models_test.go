package config

import (
	"strings"
	"testing"
)

func TestSavedOrchestratorModelValidation(t *testing.T) {
	for _, rows := range []map[string][]string{
		{"unknown": {"test"}}, {"openai": {}}, {"openai": {""}},
		{"openai": {" test"}}, {"openai": {"test\n"}}, {"openai": {"test", "test"}},
		{"openai": {strings.Repeat("x", 513)}}, {"openai": {"test\x00"}},
	} {
		if err := validateOrchestratorModels(rows); err == nil {
			t.Fatalf("accepted invalid saved models: %v", rows)
		}
	}
	s := Default()
	s.RememberOrchestratorModel("openai", "model-one")
	s.RememberOrchestratorModel("openai", "model-one")
	s.RememberOrchestratorModel("fixture-custom", "custom")
	if len(s.OrchestratorModels["openai"]) != 1 || len(s.OrchestratorModels) != 1 {
		t.Fatal("saved duplicates or custom provider metadata")
	}
	if err := validateOrchestratorModels(s.OrchestratorModels); err != nil {
		t.Fatal(err)
	}
}
