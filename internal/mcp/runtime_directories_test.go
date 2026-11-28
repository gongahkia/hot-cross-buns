package mcp

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
)

func TestRuntimeDirectoriesArePrivateAndInvalidateTrust(t *testing.T) {
	repository, _ := filepath.EvalSymlinks(t.TempDir())
	private, _ := filepath.EvalSymlinks(t.TempDir())
	os.Chmod(private, 0700)
	os.WriteFile(filepath.Join(repository, "server"), []byte("#!/bin/sh\nexit 0\n"), 0700)
	server := ServerConfig{Name: "shared", Transport: "stdio", Command: []string{"server"}}
	before, err := SaveConfiguration(repository, "", []ServerConfig{server})
	if err != nil {
		t.Fatal(err)
	}
	server.RuntimeDirectories = []string{private}
	after, err := SaveConfiguration(repository, before.Hash, []ServerConfig{server})
	if err != nil || after.Hash == before.Hash {
		t.Fatal("mount did not change reviewed bundle", err)
	}
	if _, err := OpenConfigured(context.Background(), repository, before.Hash, "shared", auth.Store{}); err == nil {
		t.Fatal("old trust allowed new mount")
	}
	os.WriteFile(filepath.Join(private, "volatile-lock"), []byte("runtime state"), 0600)
	current, err := InspectConfiguration(repository)
	if err != nil || current.Hash != after.Hash {
		t.Fatal("volatile state changed executable trust", err)
	}
	link := filepath.Join(repository, "link")
	os.Symlink(private, link)
	for _, path := range []string{"/", "relative", link, filepath.Join(private, "missing"), filepath.Join(private, "volatile-lock")} {
		server.RuntimeDirectories = []string{path}
		if err := ValidateConfiguration(repository, []ServerConfig{server}); err == nil {
			t.Fatal("unsafe runtime mount accepted", path)
		}
	}
	os.Chmod(private, 0755)
	server.RuntimeDirectories = []string{private}
	if err := ValidateConfiguration(repository, []ServerConfig{server}); err == nil {
		t.Fatal("public runtime mount accepted")
	}
	os.Chmod(private, 0700)
	server.Transport, server.Command, server.URL = "streamable_http", nil, "https://example.com/mcp"
	if err := ValidateConfiguration(repository, []ServerConfig{server}); err == nil {
		t.Fatal("HTTP accepted a local mount")
	}
}

// The subprocess must attach to the one reviewed socket without seeing siblings.
func TestMCPRuntimeSocketChild(t *testing.T) {
	if len(os.Args) < 4 || os.Args[len(os.Args)-3] != "--" {
		return
	}
	socket, sibling := os.Args[len(os.Args)-2], os.Args[len(os.Args)-1]
	if _, err := os.ReadFile(sibling); err == nil {
		os.Exit(7)
	}
	conn, err := net.DialTimeout("unix", socket, time.Second)
	if err != nil {
		os.Exit(8)
	}
	conn.Close()
	var call fixtureCall
	decoder, encoder := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	for decoder.Decode(&call) == nil {
		var result any
		switch call.Method {
		case "server/discover":
			result = modernDiscovery()
		case "tools/list":
			result = map[string]any{"resultType": "complete", "tools": []toolDescription{fixtureTool("host_status")}}
		default:
			os.Exit(9)
		}
		encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}
	os.Exit(0)
}

func TestStdioCanAttachOnlyToReviewedRuntimeSocket(t *testing.T) {
	if _, err := sandbox.StrictAvailability(); err != nil {
		t.Skip(err)
	}
	repository, _ := filepath.EvalSymlinks(t.TempDir())
	private, _ := filepath.EvalSymlinks(t.TempDir())
	os.Chmod(private, 0700)
	sibling := filepath.Join(t.TempDir(), "unrelated")
	os.WriteFile(sibling, []byte("not granted"), 0600)
	socket := filepath.Join(private, "host.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	exe, _ := os.Executable()
	os.Mkdir(filepath.Join(repository, "bin"), 0700)
	os.Symlink(exe, filepath.Join(repository, "bin", "server"))
	server, err := PinRuntime(repository, ServerConfig{Name: "shared", Transport: "stdio", Command: []string{"bin/server", "-test.run=^TestMCPRuntimeSocketChild$", "--", socket, sibling}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cfg, err := SaveConfiguration(repository, "", []ServerConfig{server})
	if err != nil {
		t.Fatal(err)
	}
	if session, err := OpenConfigured(ctx, repository, cfg.Hash, "shared", auth.Store{}); err == nil {
		session.Close()
		t.Fatal("socket accessible without mount")
	}
	server.RuntimeDirectories = []string{private}
	cfg, err = SaveConfiguration(repository, cfg.Hash, []ServerConfig{server})
	if err != nil {
		t.Fatal(err)
	}
	session, err := OpenConfigured(ctx, repository, cfg.Hash, "shared", auth.Store{})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if len(session.Tools()) != 1 {
		t.Fatal("shared server not discovered")
	}
}
