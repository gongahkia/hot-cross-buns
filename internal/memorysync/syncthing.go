package memorysync

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/config"
)

type Peer struct {
	Device     string  `json:"device"`
	State      string  `json:"state"`
	Completion float64 `json:"completion"`
}
type Syncthing struct {
	Endpoint, Key string
	Client        *http.Client
}

func (s Syncthing) request(ctx context.Context, method, path string, target any) error {
	if s.Client == nil {
		s.Client = &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.Endpoint, "/")+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", s.Key)
	response, err := s.Client.Do(req)
	if err != nil {
		return errors.New("Syncthing is not reachable at its configured local API address")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("Syncthing rejected the request; check its API key and selected folder")
	}
	if target == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return err
	}
	if len(data) >= 2<<20 {
		return errors.New("Syncthing response exceeds the supported limit")
	}
	return json.Unmarshal(data, target)
}
func (s Syncthing) Folder(ctx context.Context, id string) (string, error) {
	var folder struct {
		Path   string `json:"path"`
		Type   string `json:"type"`
		Paused bool   `json:"paused"`
	}
	if err := s.request(ctx, "GET", "/rest/config/folders/"+url.PathEscape(id), &folder); err != nil {
		return "", err
	}
	if folder.Paused || folder.Type != "sendreceive" {
		return "", errors.New("choose an unpaused send-and-receive Syncthing folder")
	}
	if !filepath.IsAbs(folder.Path) {
		return "", errors.New("Syncthing folder path must be absolute")
	}
	path, err := filepath.EvalSymlinks(folder.Path)
	if err != nil {
		return "", errors.New("the Syncthing folder is not available on this device")
	}
	if filepath.Clean(folder.Path) != path {
		return "", errors.New("choose a Syncthing folder without symbolic links")
	}
	return path, nil
}
func (s Syncthing) Progress(ctx context.Context, id string) ([]Peer, string, error) {
	var config struct {
		Devices []struct {
			DeviceID string `json:"deviceID"`
		} `json:"devices"`
	}
	if err := s.request(ctx, "GET", "/rest/config/folders/"+url.PathEscape(id), &config); err != nil {
		return nil, "Saved locally; Syncthing status unavailable", err
	}
	var status struct {
		MyID string `json:"myID"`
	}
	if err := s.request(ctx, "GET", "/rest/system/status", &status); err != nil {
		return nil, "Saved locally; Syncthing status unavailable", err
	}
	var connections struct {
		Connections map[string]struct {
			Connected bool `json:"connected"`
		} `json:"connections"`
	}
	if err := s.request(ctx, "GET", "/rest/system/connections", &connections); err != nil {
		return nil, "Saved locally; device connection status unavailable", err
	}
	peers := []Peer{}
	complete := true
	for _, device := range config.Devices {
		if device.DeviceID == status.MyID {
			continue
		}
		if len(peers) >= 16 {
			return peers, "Saved locally; too many peers to verify", nil
		}
		var completion struct {
			Completion  float64 `json:"completion"`
			RemoteState string  `json:"remoteState"`
			NeedItems   int     `json:"needItems"`
			NeedDeletes int     `json:"needDeletes"`
		}
		err := s.request(ctx, "GET", "/rest/db/completion?folder="+url.QueryEscape(id)+"&device="+url.QueryEscape(device.DeviceID), &completion)
		state := "Waiting for device"
		if err == nil && connections.Connections[device.DeviceID].Connected && completion.RemoteState == "valid" {
			state = "Syncing"
			if completion.Completion == 100 && completion.NeedItems == 0 && completion.NeedDeletes == 0 {
				state = "Files received"
			} else {
				complete = false
			}
		} else {
			complete = false
		}
		peers = append(peers, Peer{Device: device.DeviceID, State: state, Completion: completion.Completion})
	}
	if len(peers) == 0 {
		return peers, "Saved locally; no other device is paired", nil
	}
	if complete {
		return peers, "Syncthing reports paired devices up to date; HCB import is confirmed separately", nil
	}
	return peers, "Saved locally; waiting for paired devices", nil
}

func Client(stateDir string, cfg config.MemorySyncSettings) (Syncthing, error) {
	if err := cfg.Validate(); err != nil {
		return Syncthing{}, err
	}
	credentials, err := auth.New(stateDir)
	if err != nil {
		return Syncthing{}, err
	}
	credential, found, err := credentials.Read(CredentialID(cfg.Endpoint, cfg.FolderID))
	if err != nil {
		return Syncthing{}, err
	}
	key := os.Getenv("SYNCTHING_API_KEY")
	if found {
		key = credential.Key
	}
	if key == "" {
		return Syncthing{}, errors.New("connect Syncthing in Settings → Memory sync; its API key is kept on this device")
	}
	return Syncthing{Endpoint: cfg.Endpoint, Key: key}, nil
}

func Synchronize(ctx context.Context, stateDir string, cfg config.MemorySyncSettings) (Report, error) {
	if !cfg.Enabled {
		return Report{}, errors.New("memory sync is off; connect a folder in Settings → Memory sync")
	}
	client, err := Client(stateDir, cfg)
	if err != nil {
		return Report{}, err
	}
	folder, err := client.Folder(ctx, cfg.FolderID)
	if err != nil {
		return Report{}, err
	}
	if folder != cfg.Folder {
		return Report{}, errors.New("the configured Syncthing folder moved; reconnect it before syncing")
	}
	report, err := (Store{StateDir: stateDir, Folder: cfg.Folder}).Run(ctx, "", "", "")
	if err != nil {
		return report, err
	}
	if err = client.request(ctx, "POST", "/rest/db/scan?folder="+url.QueryEscape(cfg.FolderID)+"&sub=hcb-memory-profile", nil); err != nil {
		report.Issues = append(report.Issues, "Saved locally; could not request a Syncthing scan")
	}
	report.Peers, report.Delivery, err = client.Progress(ctx, cfg.FolderID)
	if err != nil {
		report.Issues = append(report.Issues, "Syncthing progress is unavailable; delivery has not been confirmed")
	}
	if err := (Store{StateDir: stateDir, Folder: cfg.Folder}).UpdateReport(report); err != nil {
		return report, err
	}
	return report, nil
}

func CredentialID(endpoint, folder string) string {
	return "syncthing-" + digest([]byte(strings.TrimRight(endpoint, "/") + "\n" + folder))[:16]
}
