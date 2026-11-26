package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestSummaryMaintenanceRejectsChangedProcessingBeforeProviderCall(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	settings := config.Default()
	settings.CustomProviders = []config.CustomProvider{{ID: "fixture", BaseURL: server.URL, Models: []string{"fixture"}, DefaultModel: "fixture"}}
	settingsStore, _ := config.DefaultStore()
	if err := settingsStore.Save(settings); err != nil {
		t.Fatal(err)
	}
	sessions, _ := worksession.Open(root)
	chat, _ := sessions.CreateChat(t.TempDir(), time.Now())
	input, err := captureConversationAdmission(workapp.ConversationInput{Version: 1, ConversationID: chat.ID, Source: chat.SourcePath, RunOptions: workapp.RunOptions{ModelProvider: "fixture", ModelName: "fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := enqueueSummaryMaintenance(context.Background(), root, input); err != nil {
		t.Fatal(err)
	}
	settings.CustomProviders[0].BaseURL = server.URL + "/changed"
	if err := settingsStore.Save(settings); err != nil {
		t.Fatal(err)
	}
	if err := runSummaryMaintenance(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("changed destination was contacted")
	}
	if _, ok, err := sessions.ClaimHistoryMaintenance(context.Background(), time.Now().Add(time.Hour)); err != nil || ok {
		t.Fatal("obsolete scope was retained", ok, err)
	}
}
