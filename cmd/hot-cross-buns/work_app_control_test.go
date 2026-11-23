package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func appControllerForTest(t *testing.T) hotCrossBunsAppController {
	t.Helper()
	store, err := config.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return hotCrossBunsAppController{stateDir: t.TempDir(), settings: store, request: &workrun.Request{}}
}

func TestHotCrossBunsAppHistoryPreferenceIsIndependentAndRejectsStaleChanges(t *testing.T) {
	c := appControllerForTest(t)
	change := workrun.AppChange{Setting: "chat_history", Value: json.RawMessage(`{"enabled":false}`)}
	prepared, err := c.Prepare(context.Background(), change)
	if err != nil {
		t.Fatal(err)
	}
	if !prepared.AfterReply {
		t.Fatal("history policy must change after the current reply")
	}
	before, _ := c.settings.Load()
	if !before.Desktop.RefersToChats() {
		t.Fatal("prepare changed history policy")
	}
	if _, err := prepared.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := c.settings.Load()
	if after.Desktop.RefersToChats() || !after.Desktop.LearnsFromChats() {
		t.Fatal("history preference changed learning or did not persist")
	}
	if _, err := prepared.Apply(context.Background()); err == nil {
		t.Fatal("stale preference update accepted")
	}
	view, err := c.Inspect(context.Background(), workrun.AppQuery{Topic: "settings"})
	if err != nil || view.(map[string]any)["refer_to_chats"] != false {
		t.Fatal("inspection omitted history policy", err)
	}
}

func TestHotCrossBunsAppChatRebindsShortcutsAndVoicePreferences(t *testing.T) {
	c := appControllerForTest(t)
	for _, change := range []workrun.AppChange{
		{Setting: "shortcuts", Value: json.RawMessage(`{"action":"command_search","shortcut":"Mod+P"}`)},
		{Setting: "shortcuts", Value: json.RawMessage(`{"action":"queue_message","shortcut":"Ctrl+Shift+K"}`)},
		{Setting: "shortcuts", Value: json.RawMessage(`{"action":"queue_message","shortcut":"Tab"}`)},
		{Setting: "shortcuts", Value: json.RawMessage(`{"action":"jump_latest","shortcut":"Ctrl+Shift+L"}`)},
		{Setting: "voice", Value: json.RawMessage(`{"spoken_replies":true,"language":"en-SG"}`)},
	} {
		mutation, err := c.Prepare(context.Background(), change)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := mutation.Apply(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	saved, _ := c.settings.Load()
	if saved.Desktop.ResolvedShortcuts()["command_search"] != "Ctrl+P" || saved.Desktop.ResolvedShortcuts()["queue_message"] != "Tab" || saved.Desktop.ResolvedShortcuts()["jump_latest"] != "Ctrl+Shift+L" || !saved.Desktop.Voice.SpokenReplies || saved.Desktop.Voice.Language != "en-SG" {
		t.Fatalf("preferences not saved: %#v", saved.Desktop)
	}
	if _, err := c.Prepare(context.Background(), workrun.AppChange{Setting: "shortcuts", Value: json.RawMessage(`{"action":"command_search","shortcut":"Mod+F"}`)}); err == nil {
		t.Fatal("conflicting keybind prepared")
	}
	saved, _ = c.settings.Load()
	if saved.Desktop.ResolvedShortcuts()["command_search"] != "Ctrl+P" {
		t.Fatal("failed rebind altered the saved binding")
	}
}

func TestHotCrossBunsAppShortcutReviewRejectsNewConcurrentConflict(t *testing.T) {
	c := appControllerForTest(t)
	mutation, err := c.Prepare(context.Background(), workrun.AppChange{Setting: "shortcuts", Value: json.RawMessage(`{"action":"command_search","shortcut":"Ctrl+K"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.settings.Update(func(s *config.Settings) error {
		s.Desktop.Shortcuts = map[string]string{"conversation_search": "Ctrl+K"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := mutation.Apply(context.Background()); err == nil {
		t.Fatal("review applied after another action took the shortcut")
	}
}

func TestHotCrossBunsAppModelAndThemeChangesStayWithinKnownSettings(t *testing.T) {
	c := appControllerForTest(t)
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "fixture", Model: "old"}
	settings.CustomProviders = []config.CustomProvider{{ID: "fixture", BaseURL: "http://127.0.0.1:11434/v1/chat/completions", Models: []string{"old", "new"}, DefaultModel: "old"}}
	if err := c.settings.Save(settings); err != nil {
		t.Fatal(err)
	}
	c.request.Provider = "fixture/old"
	change := workrun.AppChange{Setting: "model", Value: json.RawMessage(`{"provider":"fixture","model":"new"}`)}
	mutation, err := c.Prepare(context.Background(), change)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mutation.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	saved, _ := c.settings.Load()
	if saved.Defaults.Model != "new" || c.request.Provider != "fixture/old" {
		t.Fatal("model selection did not affect only future requests")
	}
	change.Value = json.RawMessage(`{"provider":"fixture","model":"unconfigured"}`)
	if _, err := c.Prepare(context.Background(), change); err == nil {
		t.Fatal("unconfigured model accepted")
	}
	mutation, err = c.Prepare(context.Background(), workrun.AppChange{Setting: "theme", Value: json.RawMessage(`{"theme":"mono"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.settings.Update(func(s *config.Settings) error { s.Theme = "contrast"; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := mutation.Apply(context.Background()); err == nil {
		t.Fatal("stale change overwrote a newer UI edit")
	}
}

func TestHotCrossBunsAppRetrievalChangesRequireUploadReviewAndPreserveChat(t *testing.T) {
	c := appControllerForTest(t)
	before, _ := c.settings.Load()
	mutation, err := c.Prepare(context.Background(), workrun.AppChange{Setting: "retrieval", Value: json.RawMessage(`{"provider":"gemini"}`)})
	if err != nil {
		t.Fatal(err)
	}
	preview, _ := json.Marshal(mutation.Preview)
	if !mutation.Review || !mutation.AfterRun || !strings.Contains(string(preview), "Uploads eligible saved memory") {
		t.Fatal("cloud retrieval did not disclose the saved text upload for review")
	}
	unchanged, _ := c.settings.Load()
	if unchanged.Embeddings != before.Embeddings {
		t.Fatal("preparing a review changed retrieval")
	}
	if _, err := mutation.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := c.settings.Load()
	if after.Embeddings.Provider != "gemini" || !after.Embeddings.CloudUploadApproved || after.Defaults != before.Defaults {
		t.Fatal("retrieval selection changed unrelated settings or lost upload consent")
	}
	if _, err := mutation.Apply(context.Background()); err == nil {
		t.Fatal("stale retrieval review was applied")
	}
	local, err := c.Prepare(context.Background(), workrun.AppChange{Setting: "retrieval", Value: json.RawMessage(`{"provider":"ollama"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ = c.settings.Load()
	if after.Embeddings.CloudUploadApproved {
		t.Fatal("local retrieval kept the cloud upload opt-in")
	}
}

func TestHotCrossBunsAppInspectionReadsUsageAndOmitsEndpointSecrets(t *testing.T) {
	c := appControllerForTest(t)
	settings := config.Default()
	settings.Defaults.Provider = "private-fixture"
	settings.CustomProviders = []config.CustomProvider{{ID: "private-fixture", BaseURL: "https://endpoint-must-stay-private.example/v1/chat/completions", APIKeyEnv: "PRIVATE_FIXTURE_KEY", Models: []string{"fixture-model"}, DefaultModel: "fixture-model"}}
	if err := c.settings.Save(settings); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PRIVATE_FIXTURE_KEY", "credential-must-stay-private")
	for _, topic := range []string{"settings", "models", "connections", "usage", "outputs"} {
		view, err := c.Inspect(context.Background(), workrun.AppQuery{Topic: topic})
		if err != nil {
			t.Fatalf("%s: %v", topic, err)
		}
		data, _ := json.Marshal(view)
		for _, secret := range []string{"endpoint-must-stay-private", "credential-must-stay-private"} {
			if strings.Contains(string(data), secret) {
				t.Fatalf("%s exposed %s", topic, secret)
			}
		}
		if topic == "usage" && view.(uisnapshot.Panel).Usage == nil {
			t.Fatal("usage inspection did not return the live usage projection")
		}
	}
	if _, err := c.Inspect(context.Background(), workrun.AppQuery{Topic: "arbitrary-file"}); err == nil {
		t.Fatal("unknown inspection accepted")
	}
}

func TestHotCrossBunsHistoryEmbeddingConsentIsIndependentAndProviderBound(t *testing.T) {
	c := appControllerForTest(t)
	ctx := context.Background()
	for _, provider := range []string{"openai", "gemini"} {
		mutation, err := c.Prepare(ctx, workrun.AppChange{Setting: "retrieval", Value: json.RawMessage(`{"provider":"` + provider + `"}`)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := mutation.Apply(ctx); err != nil {
			t.Fatal(err)
		}
		settings, _ := c.settings.Load()
		if settings.Embeddings.ChatHistoryUploadApproved {
			t.Fatal("saved-knowledge permission silently included chat history")
		}
		if _, err := configuredHistoryEmbedder(c.stateDir, settings); err == nil {
			t.Fatal("cloud history available without separate approval")
		}
		mutation, err = c.Prepare(ctx, workrun.AppChange{Setting: "retrieval", Value: json.RawMessage(`{"provider":"` + provider + `","chat_history_upload":true}`)})
		if err != nil {
			t.Fatal(err)
		}
		preview, _ := json.Marshal(mutation.Preview)
		if !mutation.Review || !strings.Contains(string(preview), "conversation excerpts") {
			t.Fatal("missing separate upload review", string(preview))
		}
		before, _ := c.settings.Load()
		if before.Embeddings.ChatHistoryUploadApproved {
			t.Fatal("preparation changed consent")
		}
		if _, err := mutation.Apply(ctx); err != nil {
			t.Fatal(err)
		}
		settings, _ = c.settings.Load()
		if !settings.Embeddings.ChatHistoryUploadApproved {
			t.Fatal("reviewed permission not saved")
		}
	}
	mutation, err := c.Prepare(ctx, workrun.AppChange{Setting: "retrieval", Value: json.RawMessage(`{"provider":"ollama"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mutation.Apply(ctx); err != nil {
		t.Fatal(err)
	}
	settings, _ := c.settings.Load()
	if settings.Embeddings.ChatHistoryUploadApproved || settings.Embeddings.CloudUploadApproved {
		t.Fatal("cloud permission transferred to local provider")
	}
	e, err := configuredHistoryEmbedder(c.stateDir, settings)
	if err != nil || !strings.HasPrefix(e.ID(), "ollama/") {
		t.Fatal("local default unavailable", err)
	}
}
