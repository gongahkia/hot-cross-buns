package branding_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/branding"
	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/model"
	"github.com/gongahkia/hot-cross-buns/internal/websearch"
)

func TestCatalogMatchesImplementedAdapters(t *testing.T) {
	data, err := os.ReadFile("catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog []branding.Brand
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	providers := map[string]bool{}
	identities := map[string]bool{}
	for _, brand := range catalog {
		if identities[brand.ID] || !branding.Valid(brand.ID) {
			t.Fatalf("invalid duplicate brand %q", brand.ID)
		}
		identities[brand.ID] = true
		for _, provider := range brand.Providers {
			if (!model.SupportsDirect(model.Provider(provider)) && provider != localmodel.ProviderID) || providers[provider] {
				t.Fatalf("unimplemented/duplicate provider %q", provider)
			}
			providers[provider] = true
		}
	}
	for _, provider := range model.Names() {
		if provider != "openai-compatible" && !providers[provider] {
			t.Errorf("missing provider %q", provider)
		}
	}
	for _, provider := range websearch.Providers() {
		if branding.Search(provider.ID) == "" {
			t.Errorf("missing search %q", provider.ID)
		}
	}
	for _, kind := range []string{"slack", "google_workspace", "atlassian", "notion", "github", "gitlab", "microsoft365", "linear", "todoist", "dropbox"} {
		if branding.Connector(kind) == "" {
			t.Errorf("missing connector %q", kind)
		}
	}
	for _, role := range []string{"cli_codex", "cli_claude", "cli_pi", "cli_opencode", "cli_gemini", "cli_copilot"} {
		if branding.Specialist(role) == "" {
			t.Errorf("missing specialist %q", role)
		}
	}
	for _, unknown := range []string{"", "https://example.com/logo.png", "../../secret", "__proto__", "cli_unknown", "http_json", "remote_mcp", "openai-compatible"} {
		if branding.Valid(unknown) || branding.Connector(unknown) != "" || branding.Specialist(unknown) != "" {
			t.Errorf("invented brand %q", unknown)
		}
	}
}
