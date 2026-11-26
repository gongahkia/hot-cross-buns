package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/config"
)

func TestComposerModelsKeepAliasesSeparateFromIdentityAndHidePrivateConfiguration(t *testing.T) {
	store, err := config.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "fixture", Model: "model-one"}
	settings.CustomProviders = []config.CustomProvider{
		{ID: "fixture", BaseURL: "http://localhost:1234/private-endpoint", Models: []string{"model-one", "model-two"}, DefaultModel: "model-one"},
		{ID: "locked", BaseURL: "http://localhost:1234/another-private-endpoint", APIKeyEnv: "HOT_CROSS_BUNS_COMPOSER_TEST_KEY", Models: []string{"locked-model"}, DefaultModel: "locked-model"},
	}
	settings.ModelAliases = map[string]string{config.ModelAliasKey("fixture", "model-two"): "Friendly model"}
	t.Setenv("HOT_CROSS_BUNS_COMPOSER_TEST_KEY", "")
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	choices, err := workComposerModels(store, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	seenAlias, seenLocked := false, false
	for _, choice := range choices {
		if choice.Provider == "fixture" && choice.Model == "model-two" {
			seenAlias = choice.Label == "Friendly model" && choice.Unavailable == ""
		}
		if choice.Provider == "locked" {
			seenLocked = true
		}
	}
	if !seenAlias || seenLocked {
		t.Fatal("incorrect configured model metadata")
	}
	encoded, _ := json.Marshal(choices)
	if strings.Contains(string(encoded), "private-endpoint") || strings.Contains(string(encoded), "HOT_CROSS_BUNS_COMPOSER_TEST_KEY") {
		t.Fatal("picker exposed private configuration")
	}
}

func TestComposerModelsOmitUnconfiguredSavedSelection(t *testing.T) {
	t.Setenv("OPENCODE_API_KEY", "")
	store, err := config.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "opencode", Model: "kimi-k2.7-code"}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	choices, err := workComposerModels(store, stateDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, choice := range choices {
		if choice.Provider == "opencode" {
			t.Fatal("saved defaults exposed an unconfigured provider in the picker")
		}
	}
	credentials, err := auth.New(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := credentials.Put("opencode", auth.Credential{Type: "api_key", Key: "composer-fixture-key"}); err != nil {
		t.Fatal(err)
	}
	choices, err = workComposerModels(store, stateDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, choice := range choices {
		if choice.Provider == "opencode" && choice.Model == "kimi-k2.7-code" && choice.Unavailable == "" {
			return
		}
	}
	t.Fatal("configured selection did not become available after setup")
}

func TestSavedCloudModelsRemainSelectableAfterSwitchingProviders(t *testing.T) {
	b := nativeProviderFixture(t)
	t.Setenv("OPENAI_API_KEY", "saved-model-fixture")
	settings, _ := b.settings.Load()
	settings.Defaults = config.Defaults{Provider: "openai", Model: "custom-first"}
	if err := b.settings.Save(settings); err != nil {
		t.Fatal(err)
	}
	defaults := workModelDefaults{settings: b.settings}
	for _, choice := range [][2]string{{"openai", "custom-second"}, {"anthropic", "claude-sonnet-5"}} {
		if err := defaults.SetDefaults(choice[0], choice[1]); err != nil {
			t.Fatal(err)
		}
	}
	choices, err := workComposerModels(b.settings, b.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, wanted := range []string{"custom-first", "custom-second"} {
		found := false
		for _, choice := range choices {
			found = found || choice.Provider == "openai" && choice.Model == wanted && choice.Unavailable == ""
		}
		if !found {
			t.Fatalf("lost saved model %q after switching providers", wanted)
		}
	}
	if err := defaults.SetDefaults("openai", "custom-first"); err != nil {
		t.Fatal(err)
	}
}
