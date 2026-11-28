package mcp

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

// PinRuntime records an external interpreter only for a final symlink beneath
// the project. Ordinary repository-local executables keep the existing rule.
func PinRuntime(repository string, s ServerConfig) (ServerConfig, error) {
	if s.Transport != "stdio" {
		return s, nil
	}
	if e := validateServer(s); e != nil {
		return s, e
	}
	s.RuntimePath = ""
	s.RuntimeSHA256 = ""
	root, e := workspace.Open(repository)
	if e != nil {
		return s, e
	}
	if _, e = root.ResolveFile(s.Command[0]); e == nil {
		return s, nil
	}
	parent, e := root.ResolveFile(filepath.Dir(s.Command[0]))
	if e != nil {
		return s, e
	}
	path := filepath.Join(parent, filepath.Base(s.Command[0]))
	info, e := os.Lstat(path)
	if e != nil || info.Mode()&os.ModeSymlink == 0 {
		return s, errors.New("stdio executable must be repository-local or an explicitly pinned interpreter symlink")
	}
	resolved, e := filepath.EvalSymlinks(path)
	if e != nil {
		return s, e
	}
	digest, e := runtimeDigest(resolved)
	if e != nil {
		return s, e
	}
	s.RuntimePath = resolved
	s.RuntimeSHA256 = digest
	return s, nil
}
func runtimeDigest(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Mode()&0111 == 0 || info.Size() > maxExecutable {
		return "", errors.New("pinned runtime must be a bounded executable regular file")
	}
	hash := sha256.New()
	n, e := io.Copy(hash, io.LimitReader(f, maxExecutable+1))
	if e != nil || n > maxExecutable {
		return "", errors.New("could not hash the bounded runtime")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func serverExecutableHash(root workspace.Root, s server) (string, error) {
	if s.RuntimePath == "" {
		return executableHash(root, s.Command[0])
	}
	pinned, e := PinRuntime(root.Path(), server{Name: s.Name, Transport: s.Transport, Command: s.Command, Network: s.Network})
	if e != nil {
		return "", e
	}
	if pinned.RuntimePath != s.RuntimePath || pinned.RuntimeSHA256 != s.RuntimeSHA256 {
		return "", errors.New("MCP interpreter changed; prepare and review setup again")
	}
	return pinned.RuntimeSHA256, nil
}

func executableBundleHash(root workspace.Root, s server) (string, error) {
	if s.RuntimePath == "" {
		return executableHash(root, s.Command[0])
	}
	current, e := PinRuntime(root.Path(), s)
	if e != nil {
		return "", e
	}
	if current.RuntimePath == "" {
		return executableHash(root, s.Command[0])
	}
	return current.RuntimeSHA256, nil
}
