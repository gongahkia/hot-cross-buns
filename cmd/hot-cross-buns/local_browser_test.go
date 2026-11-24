package main

import (
	"context"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/browser"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestConfiguredLocalModelRetainsExplicitBrowserGrant(t *testing.T) {
	useGenerousLocalModelHost(t)
	root, store, session := browserControlsFixture(t)
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	server := newLocalModelServer(t)
	defer server.Close()
	if _, err := testLocalManager(t, server.URL).Use(context.Background(), "qwen2.5-coder-7b"); err != nil {
		t.Fatal(err)
	}
	client, err := browser.NewClient(store, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	session, err = client.SetPaused(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	request := workrun.Request{BrowserSession: session.ID, BrowserPolicy: browser.PolicyDigest(session)}
	service, err := configuredWorkService(localmodel.ProviderID, "", root, &request)
	if err != nil {
		t.Fatal(err)
	}
	if request.DisableBrowser || service.Executor.Browser == nil {
		t.Fatal("local provider discarded reviewed browser capability")
	}
	visual, ok := service.Executor.Model.(agent.VisualInputModel)
	if !ok || visual.SupportsVisualInput() {
		t.Fatal("local model was incorrectly upgraded to visual input")
	}
	tabs, err := service.Executor.Browser.Tabs(context.Background(), session.ID)
	if err != nil || len(tabs) != 1 || tabs[0].ID != session.SelectedTabs[0].ID {
		t.Fatal("selected tab grant lost", tabs, err)
	}
	request.DisableBrowser = true
	if _, err := configuredWorkService(localmodel.ProviderID, "", root, &request); err != nil {
		t.Fatal(err)
	}
	if !request.DisableBrowser {
		t.Fatal("configured route overrode explicit caller restriction")
	}
	settings, _ := config.DefaultStore()
	saved, _ := settings.Load()
	if saved.Defaults.Provider != localmodel.ProviderID {
		t.Fatal("local model silently changed provider")
	}
}
