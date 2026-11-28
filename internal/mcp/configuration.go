package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

// ServerConfig contains public configuration only, never credentials.
type ServerConfig = server
type Configuration struct {
	Hash    string         `json:"expected_digest"`
	Servers []ServerConfig `json:"servers"`
}

var configurationMu sync.Mutex

// InspectConfiguration validates configuration without connecting or starting a process.
func InspectConfiguration(repository string) (Configuration, error) {
	root, e := workspace.Open(repository)
	if e != nil {
		return Configuration{}, e
	}
	doc, digest, e := loadManifest(root)
	return Configuration{Hash: digest, Servers: doc.Servers}, e
}
func ValidateConfiguration(repository string, servers []ServerConfig) error {
	root, e := workspace.Open(repository)
	if e != nil {
		return e
	}
	doc := manifest{Version: manifestVersion, Servers: servers}
	contents, e := json.MarshalIndent(doc, "", "  ")
	if e != nil {
		return e
	}
	if len(contents) > maxManifest {
		return errors.New("MCP manifest exceeds 64 KiB")
	}
	for _, s := range servers {
		if strings.ContainsAny(s.URL, "?#") {
			return errors.New("MCP setup requires an endpoint without query credentials or fragment; use private authentication controls")
		}
	}
	_, _, e = validateManifest(root, doc, contents)
	return e
}

// SaveConfiguration compares the reviewed bundle, including executable bytes, before replacing it.
// It neither trusts the new bundle nor starts servers.
func SaveConfiguration(repository, expected string, servers []ServerConfig) (Configuration, error) {
	configurationMu.Lock()
	defer configurationMu.Unlock()
	root, e := workspace.Open(repository)
	if e != nil {
		return Configuration{}, e
	}
	_, current, e := loadManifest(root)
	if e != nil {
		return Configuration{}, e
	}
	if current != expected {
		return Configuration{}, errors.New("MCP configuration or executable changed; inspect and review again")
	}
	if e = ValidateConfiguration(repository, servers); e != nil {
		return Configuration{}, e
	}
	contents, _ := json.MarshalIndent(manifest{Version: manifestVersion, Servers: servers}, "", "  ")
	if e = root.WriteRegularFileAtomic(manifestPath, contents, maxManifest); e != nil {
		return Configuration{}, e
	}
	return InspectConfiguration(repository)
}

// RemoteTool describes discovery metadata; discovering tools never calls one.
type RemoteTool = toolDescription

func DiscoverRemoteTools(ctx context.Context, endpoint, token string) ([]RemoteTool, error) {
	if e := validateServer(server{Name: "discovery", Transport: "streamable_http", URL: endpoint}); e != nil {
		return nil, e
	}
	client := newAuthorizedHTTPClient(endpoint, token)
	defer client.Close()
	return listTools(ctx, client)
}

// ConfigurationHash validates a proposed bundle without publishing it.
func ConfigurationHash(repository string, servers []ServerConfig) (string, error) {
	if e := ValidateConfiguration(repository, servers); e != nil {
		return "", e
	}
	root, e := workspace.Open(repository)
	if e != nil {
		return "", e
	}
	doc := manifest{Version: manifestVersion, Servers: servers}
	contents, _ := json.MarshalIndent(doc, "", "  ")
	_, hash, e := validateManifest(root, doc, contents)
	return hash, e
}

// DiscoverConfigured initializes only the selected, exact trusted server and
// lists tools; no tools/call is sent.
func DiscoverConfigured(ctx context.Context, repository, hash, name string, credentials auth.Store) ([]RemoteTool, error) {
	root, e := workspace.Open(repository)
	if e != nil {
		return nil, e
	}
	doc, current, e := loadManifest(root)
	if e != nil {
		return nil, e
	}
	if current == "" || current != hash {
		return nil, errors.New("MCP bundle changed before verification")
	}
	for _, s := range doc.Servers {
		if s.Name == name {
			client, e := connect(ctx, root, s, credentials)
			if e != nil {
				return nil, e
			}
			defer client.Close()
			return listTools(ctx, client)
		}
	}
	return nil, errors.New("MCP server not found")
}
