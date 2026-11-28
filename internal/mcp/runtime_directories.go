package mcp

import (
	"errors"
	"os"
	"path/filepath"
)

// Runtime directories are explicit, hash-reviewed mounts for shared IPC state.
// Their volatile contents are not executable pins and never enter the bundle hash.
func validateRuntimeDirectories(server server) error {
	if len(server.RuntimeDirectories) > 8 || len(server.RuntimeDirectories) > 0 && server.Transport != "stdio" {
		return errors.New("MCP runtime directories require stdio and at most eight private directories")
	}
	seen := map[string]bool{}
	for _, path := range server.RuntimeDirectories {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == string(filepath.Separator) || seen[path] {
			return errors.New("MCP runtime directories must be distinct canonical absolute private directories")
		}
		seen[path] = true
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil || resolved != path {
			return errors.New("MCP runtime directory is missing or traverses a symlink")
		}
		home, _ := os.UserHomeDir()
		home, _ = filepath.EvalSymlinks(home)
		temporary, _ := filepath.EvalSymlinks(os.TempDir())
		if path == home || path == temporary {
			return errors.New("MCP runtime mount must not expose the whole home or temporary directory")
		}
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
			return errors.New("MCP runtime directory must exist and be private to its owner (0700)")
		}
	}
	return nil
}
