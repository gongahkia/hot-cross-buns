package config

import (
	"errors"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/model"
)

// RememberOrchestratorModel retains explicit API model IDs across selection
// changes. Custom endpoints keep their model lists in CustomProviders.
func (s *Settings) RememberOrchestratorModel(provider, name string) {
	p, err := model.ParseProvider(provider)
	name = strings.TrimSpace(name)
	if err != nil || !model.SupportsDirect(p) || name == "" {
		return
	}
	for _, existing := range s.OrchestratorModels[provider] {
		if existing == name {
			return
		}
	}
	if s.OrchestratorModels == nil {
		s.OrchestratorModels = make(map[string][]string)
	}
	s.OrchestratorModels[provider] = append(s.OrchestratorModels[provider], name)
}

func validateOrchestratorModels(providers map[string][]string) error {
	count := 0
	for id, models := range providers {
		p, err := model.ParseProvider(id)
		if err != nil || string(p) != id || !model.SupportsDirect(p) || len(models) == 0 {
			return errors.New("saved orchestrator provider is invalid")
		}
		seen := make(map[string]bool)
		for _, name := range models {
			count++
			if count > 512 || strings.TrimSpace(name) != name || name == "" || len(name) > 512 || strings.ContainsAny(name, "\x00\r\n") || seen[name] {
				return errors.New("saved orchestrator model is invalid or duplicated")
			}
			seen[name] = true
		}
	}
	return nil
}
