package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/memorysync"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestMemorySyncConnectsOnlySelectedFolderAndKeepsCredentialsLocal(t *testing.T) {
	ctx := context.Background()
	c := appControllerForTest(t)
	var err error
	c.stateDir, err = filepath.EvalSymlinks(c.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	folder, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const secret = "fixture-syncthing-key-not-for-export"
	scans := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != secret {
			w.WriteHeader(403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/rest/config/folders/memory":
			json.NewEncoder(w).Encode(map[string]any{"path": folder, "type": "sendreceive", "devices": []map[string]string{{"deviceID": "local"}, {"deviceID": "remote"}}})
		case "/rest/system/status":
			w.Write([]byte(`{"myID":"local"}`))
		case "/rest/system/connections":
			w.Write([]byte(`{"connections":{"remote":{"connected":false}}}`))
		case "/rest/db/completion":
			w.Write([]byte(`{"completion":100,"remoteState":"valid"}`))
		case "/rest/db/scan":
			if r.Method != "POST" || r.URL.Query().Get("folder") != "memory" || r.URL.Query().Get("sub") != "hcb-memory-profile" {
				t.Error("scan escaped its selected folder")
			}
			scans++
			w.WriteHeader(200)
		default:
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	initial, _ := c.settings.Load()
	connected, err := applyMemorySyncRequest(ctx, c.stateDir, c.settings, memorySyncRequest{Action: "configure", Revision: memorySyncRevision(initial.MemorySync), Endpoint: api.URL, FolderID: "memory", APIKey: secret})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(connected)
	if strings.Contains(string(encoded), secret) {
		t.Fatal("API key escaped through status")
	}
	settings, _ := c.settings.Load()
	credentials, _ := auth.New(c.stateDir)
	key, found, err := credentials.Read(memorysync.CredentialID(api.URL, "memory"))
	if err != nil || !found || key.Key != secret {
		t.Fatal("missing private API key", err)
	}
	memories, _ := memory.Open(c.stateDir)
	memories.Add("preference", "Keep it casual.", "", "", time.Time{})
	result, err := applyMemorySyncRequest(ctx, c.stateDir, c.settings, memorySyncRequest{Action: "run"})
	if err != nil {
		t.Fatal(err)
	}
	report := result["report"].(memorysync.Report)
	if scans != 1 || !strings.Contains(report.Delivery, "waiting") || len(report.Peers) != 1 || report.Peers[0].State != "Waiting for device" {
		t.Fatal("offline device was reported delivered", scans, report)
	}
	payload, _ := json.Marshal(settings)
	if strings.Contains(string(payload), secret) {
		t.Fatal("API key entered ordinary settings")
	}
	inspected, err := c.Inspect(ctx, workrun.AppQuery{Topic: "memory_sync"})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ = json.Marshal(inspected)
	if strings.Contains(string(payload), secret) || strings.Contains(string(payload), folder) {
		t.Fatal("model-facing inspection exposed private setup")
	}
	_, err = applyMemorySyncRequest(ctx, c.stateDir, c.settings, memorySyncRequest{Action: "disable", Revision: "stale"})
	if err == nil {
		t.Fatal("stale settings mutation accepted")
	}
	prepared, err := c.Prepare(ctx, workrun.AppChange{Setting: "memory_sync", Value: json.RawMessage(`{"action":"pause","expected_revision":"` + memorySyncRevision(settings.MemorySync) + `"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = prepared.Apply(ctx); err != nil {
		t.Fatal(err)
	}
	paused, _ := c.settings.Load()
	if paused.MemorySync.Enabled {
		t.Fatal("pause was ignored")
	}
	resume, err := c.Prepare(ctx, workrun.AppChange{Setting: "memory_sync", Value: json.RawMessage(`{"action":"resume","expected_revision":"` + memorySyncRevision(paused.MemorySync) + `"}`)})
	if err != nil || !resume.Review {
		t.Fatal("resuming unattended exchange needs review", err)
	}
	if _, err = c.Prepare(ctx, workrun.AppChange{Setting: "memory_sync", Value: json.RawMessage(`{"action":"configure","api_key":"secret"}`)}); err == nil {
		t.Fatal("model setup accepted a credential")
	}
	if _, err = applyMemorySyncRequest(ctx, c.stateDir, c.settings, memorySyncRequest{Action: "configure", Revision: memorySyncRevision(paused.MemorySync), Endpoint: "https://remote.invalid", FolderID: "memory", APIKey: secret}); err == nil {
		t.Fatal("remote API accepted")
	}
}

func TestMemorySyncDefaultsOffAndCannotBeConfiguredFromTheModel(t *testing.T) {
	c := appControllerForTest(t)
	var err error
	c.stateDir, err = filepath.EvalSymlinks(c.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	view, err := c.inspectMemorySync()
	if err != nil {
		t.Fatal(err)
	}
	if view.(map[string]any)["enabled"] != false {
		t.Fatal(view)
	}
	if _, err = c.prepareMemorySync(workrun.AppChange{Value: json.RawMessage(`{"action":"run"}`)}); err == nil {
		t.Fatal("unconfigured sync ran")
	}
	if err := (config.MemorySyncSettings{Enabled: true, Folder: c.stateDir, FolderID: "memory", Endpoint: "http://127.0.0.1:8384?token=secret"}).Validate(); err == nil {
		t.Fatal("credential-like API URL accepted")
	}
}
