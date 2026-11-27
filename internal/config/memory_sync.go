package config

import (
	"errors"
	"net/url"
	"path/filepath"
	"strings"
)

type MemorySyncSettings struct {
	Enabled  bool   `json:"enabled"`
	Folder   string `json:"folder,omitempty"`
	Endpoint string `json:"endpoint,omitempty"`
	FolderID string `json:"folder_id,omitempty"`
}

func (s MemorySyncSettings) Validate() error {
	if !s.Enabled && s.Folder == "" && s.Endpoint == "" && s.FolderID == "" {
		return nil
	}
	if !filepath.IsAbs(s.Folder) || strings.ContainsAny(s.Folder, "\x00\r\n") || len(s.Folder) > 4096 || s.FolderID == "" || len(s.FolderID) > 128 || strings.ContainsAny(s.FolderID, "\x00\r\n") {
		return errors.New("choose an existing Syncthing folder")
	}
	u, err := url.Parse(s.Endpoint)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || u.Scheme != "http" && u.Scheme != "https" || u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1" {
		return errors.New("use a local Syncthing API address without credentials or a path")
	}
	return nil
}
