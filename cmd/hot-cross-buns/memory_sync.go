package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/memorysync"
)

type memorySyncRequest struct {
	Action   string `json:"action"`
	Revision string `json:"revision,omitempty"`
	Endpoint string `json:"endpoint,omitempty"`
	FolderID string `json:"folder_id,omitempty"`
	APIKey   string `json:"api_key,omitempty"`
	Key      string `json:"key,omitempty"`
	Choice   string `json:"choice,omitempty"`
	Enabled  *bool  `json:"enabled,omitempty"`
}

func memorySyncRevision(cfg config.MemorySyncSettings) string {
	data, _ := json.Marshal(cfg)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func memorySyncCommand(stateDir string, args []string, out io.Writer) error {
	request := memorySyncRequest{Action: "status"}
	if len(args) == 1 && args[0] == "request" {
		data, err := io.ReadAll(io.LimitReader(os.Stdin, (32<<10)+1))
		if err != nil {
			return err
		}
		if len(data) > 32<<10 {
			return errors.New("memory sync request exceeds size limit")
		}
		decoder := json.NewDecoder(strings.NewReader(string(data)))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&request); err != nil {
			return errors.New("invalid memory sync request")
		}
		if decoder.Decode(new(any)) != io.EOF {
			return errors.New("trailing memory sync data")
		}
	} else if len(args) == 1 {
		request.Action = args[0]
	} else if len(args) > 1 {
		return errors.New("use memory sync status, run, or request")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	configDir, err := config.ResolveDir(os.Getenv("HOT_CROSS_BUNS_CONFIG_DIR"))
	if err != nil {
		return err
	}
	settingsStore, err := config.New(configDir)
	if err != nil {
		return err
	}
	result, err := applyMemorySyncRequest(ctx, stateDir, settingsStore, request)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
func memorySyncStatus(stateDir string, settings config.Settings) (map[string]any, error) {
	report, err := (memorysync.Store{StateDir: stateDir, Folder: settings.MemorySync.Folder}).Status()
	if err != nil {
		return nil, err
	}
	return map[string]any{"config": settings.MemorySync, "revision": memorySyncRevision(settings.MemorySync), "report": report, "scope": "Personal memories, preferences and saved reference notes. Credentials, device permissions, models and running tasks stay on this device."}, nil
}
func applyMemorySyncRequest(ctx context.Context, stateDir string, store config.Store, r memorySyncRequest) (map[string]any, error) {
	settings, err := store.Load()
	if err != nil {
		return nil, err
	}
	prior := settings.MemorySync
	switch r.Action {
	case "status":
		return memorySyncStatus(stateDir, settings)
	case "configure":
		if r.Revision != memorySyncRevision(prior) {
			return nil, errors.New("memory sync settings changed; refresh before connecting")
		}
		endpoint := strings.TrimRight(r.Endpoint, "/")
		if endpoint == "" {
			endpoint = "http://127.0.0.1:8384"
		}
		cfg := config.MemorySyncSettings{Enabled: true, Endpoint: endpoint, FolderID: r.FolderID, Folder: stateDir}
		if err = cfg.Validate(); err != nil {
			return nil, err
		}
		credentials, err := auth.New(stateDir)
		if err != nil {
			return nil, err
		}
		credential, found, err := credentials.Read(memorysync.CredentialID(endpoint, r.FolderID))
		if err != nil {
			return nil, err
		}
		key := r.APIKey
		if key == "" && found {
			key = credential.Key
		}
		if key == "" {
			key = os.Getenv("SYNCTHING_API_KEY")
		}
		if key == "" || len(key) > 4096 || strings.ContainsAny(key, "\r\n\x00") {
			return nil, errors.New("enter the Syncthing API key in these settings; it stays on this device")
		}
		client := memorysync.Syncthing{Endpoint: endpoint, Key: key}
		folder, err := client.Folder(ctx, r.FolderID)
		if err != nil {
			return nil, err
		}
		cfg.Folder = folder
		statePath, err := filepath.EvalSymlinks(stateDir)
		if err != nil {
			return nil, err
		}
		if err = os.MkdirAll(filepath.Dir(store.Path()), 0700); err != nil {
			return nil, err
		}
		configPath, err := filepath.EvalSymlinks(filepath.Dir(store.Path()))
		if err != nil {
			return nil, err
		}
		for _, private := range []string{statePath, configPath} {
			if withinDirectory(folder, private) || withinDirectory(private, folder) {
				return nil, errors.New("choose a dedicated sync folder outside HCB's private state and configuration")
			}
		}
		if r.APIKey != "" {
			var expected *auth.Credential
			if found {
				expected = &credential
			}
			next := auth.Credential{Type: "api_key", Key: key}
			if err = credentials.ReplaceReviewed(memorysync.CredentialID(endpoint, r.FolderID), expected, &next); err != nil {
				return nil, err
			}
		}
		err = store.Update(func(current *config.Settings) error {
			if current.MemorySync != prior {
				return errors.New("memory sync settings changed; refresh before connecting")
			}
			current.MemorySync = cfg
			return nil
		})
		if err != nil {
			return nil, err
		}
	case "enable", "disable":
		if r.Revision != memorySyncRevision(prior) {
			return nil, errors.New("memory sync settings changed; refresh before changing them")
		}
		if prior.Folder == "" {
			return nil, errors.New("connect a Syncthing folder first")
		}
		err = store.Update(func(current *config.Settings) error {
			if current.MemorySync != prior {
				return errors.New("memory sync settings changed")
			}
			current.MemorySync.Enabled = r.Action == "enable"
			return nil
		})
		if err != nil {
			return nil, err
		}
	case "run":
		if _, err = memorysync.Synchronize(ctx, stateDir, prior); err != nil {
			return nil, err
		}
	case "resolve":
		if !prior.Enabled {
			return nil, errors.New("enable memory sync before resolving a conflict")
		}
		client, err := memorysync.Client(stateDir, prior)
		if err != nil {
			return nil, err
		}
		folder, err := client.Folder(ctx, prior.FolderID)
		if err != nil || folder != prior.Folder {
			return nil, errors.New("reconnect the original Syncthing folder before resolving a conflict")
		}
		if _, err = (memorysync.Store{StateDir: stateDir, Folder: prior.Folder}).Run(ctx, r.Key, r.Revision, r.Choice); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unknown memory sync action %q", r.Action)
	}
	settings, err = store.Load()
	if err != nil {
		return nil, err
	}
	return memorySyncStatus(stateDir, settings)
}
func withinDirectory(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && (rel == "." || rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func memorySyncLoop(ctx context.Context, stateDir string) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		settings, err := loadSettings()
		if err == nil && settings.MemorySync.Enabled {
			bounded, cancel := context.WithTimeout(ctx, 12*time.Second)
			report, err := memorysync.Synchronize(bounded, stateDir, settings.MemorySync)
			cancel()
			if err != nil {
				report.LastRun = time.Now().UTC()
				report.Issues = []string{"Memory sync needs attention: " + err.Error()}
				report.Delivery = "Saved locally; sync has not completed"
				_ = (memorysync.Store{StateDir: stateDir, Folder: settings.MemorySync.Folder}).UpdateReport(report)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
