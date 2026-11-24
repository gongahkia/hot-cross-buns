// Package fileaccess owns explicit, revocable access to the live filesystem.
package fileaccess

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

var ErrChanged = errors.New("filesystem permissions changed; review access in a new task")

const MaxBytes = 1024 * 1024

type Grant struct {
	ID       string `json:"id"`
	Root     string `json:"root"`
	Access   string `json:"access"`
	Identity string `json:"identity"`
}
type Policy struct {
	Version  int     `json:"version"`
	Revision uint64  `json:"revision"`
	Full     bool    `json:"full_access"`
	Grants   []Grant `json:"grants"`
}
type Store struct {
	directory string
	protected []string
	mu        sync.Mutex
}

func Open(stateDir string, protected ...string) (*Store, error) {
	if !filepath.IsAbs(stateDir) {
		return nil, errors.New("filesystem permission storage must be absolute")
	}
	stateDir, err := filepath.EvalSymlinks(stateDir)
	if err != nil {
		return nil, err
	}
	s := &Store{directory: filepath.Join(stateDir, "hot-cross-buns", "file-permissions"), protected: append([]string{filepath.Join(stateDir, "hot-cross-buns")}, protected...)}
	if home, err := os.UserHomeDir(); err == nil {
		s.protected = append(s.protected, filepath.Join(home, ".config", "hot-cross-buns"))
	}
	for i, p := range s.protected {
		if !filepath.IsAbs(p) {
			return nil, errors.New("protected filesystem paths must be absolute")
		}
		s.protected[i] = filepath.Clean(p)
	}
	if err := privatefs.MkdirAll(s.directory); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Store) Protected() []string { return append([]string(nil), s.protected...) }
func (s *Store) lock() (func(), error) {
	s.mu.Lock()
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	f, err := filelock.OpenRootFile(root, ".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		root.Close()
		s.mu.Unlock()
		return nil, err
	}
	if err = filelock.Lock(f, filelock.Exclusive); err != nil {
		f.Close()
		root.Close()
		s.mu.Unlock()
		return nil, err
	}
	return func() { _ = filelock.Unlock(f); _ = f.Close(); _ = root.Close(); s.mu.Unlock() }, nil
}
func (s *Store) load() (Policy, error) {
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return Policy{}, err
	}
	defer root.Close()
	data, err := root.ReadFile("permissions.json")
	if errors.Is(err, os.ErrNotExist) {
		return Policy{Version: 1, Revision: 1, Grants: []Grant{}}, nil
	}
	if err != nil {
		return Policy{}, err
	}
	var p Policy
	if len(data) > 128*1024 || json.Unmarshal(data, &p) != nil || p.Version != 1 || p.Revision == 0 || len(p.Grants) > 128 {
		return p, errors.New("invalid filesystem permission policy")
	}
	seen := map[string]bool{}
	for _, g := range p.Grants {
		if len(g.ID) != 32 || seen[g.ID] || !filepath.IsAbs(g.Root) || filepath.Dir(g.Root) == g.Root || g.Identity == "" || (g.Access != "read" && g.Access != "write") {
			return p, errors.New("invalid saved folder grant")
		}
		seen[g.ID] = true
	}
	return p, nil
}
func (s *Store) Get() (Policy, error) {
	unlock, err := s.lock()
	if err != nil {
		return Policy{}, err
	}
	defer unlock()
	return s.load()
}
func (s *Store) change(revision uint64, apply func(*Policy) error) (Policy, error) {
	unlock, err := s.lock()
	if err != nil {
		return Policy{}, err
	}
	defer unlock()
	p, err := s.load()
	if err != nil {
		return p, err
	}
	if p.Revision != revision || revision == ^uint64(0) {
		return p, ErrChanged
	}
	if err = apply(&p); err != nil {
		return p, err
	}
	p.Revision++
	data, err := json.Marshal(p)
	if err != nil {
		return p, err
	}
	root, err := workspace.Open(s.directory)
	if err != nil {
		return p, err
	}
	err = root.WriteRegularFileAtomic("permissions.json", data, 128*1024)
	return p, err
}
func (s *Store) SetFull(revision uint64, enabled bool) (Policy, error) {
	return s.change(revision, func(p *Policy) error { p.Full = enabled; return nil })
}
func (s *Store) Revoke(revision uint64, id string) (Policy, error) {
	return s.change(revision, func(p *Policy) error {
		for i, g := range p.Grants {
			if g.ID == id {
				p.Grants = append(p.Grants[:i], p.Grants[i+1:]...)
				return nil
			}
		}
		return errors.New("folder grant no longer exists")
	})
}
func (s *Store) RevokeAll(revision uint64) (Policy, error) {
	return s.change(revision, func(p *Policy) error { p.Full = false; p.Grants = []Grant{}; return nil })
}
func (s *Store) Add(revision uint64, folder, access, identity string) (Policy, error) {
	if access != "read" && access != "write" {
		return Policy{}, errors.New("choose read or write access")
	}
	root, err := canonicalFolder(folder)
	if err != nil {
		return Policy{}, err
	}
	if filepath.Dir(root) == root {
		return Policy{}, errors.New("use the explicit full filesystem setting for root access")
	}
	if s.blocked(root) {
		return Policy{}, errors.New("HCB permission and execution records cannot be granted")
	}
	actual, err := folderIdentity(root)
	if err != nil || actual != identity {
		return Policy{}, errors.New("folder changed since access was reviewed")
	}
	return s.change(revision, func(p *Policy) error {
		if len(p.Grants) >= 128 {
			return errors.New("too many saved folder permissions")
		}
		for i, g := range p.Grants {
			if g.Root == root {
				p.Grants = append(p.Grants[:i], p.Grants[i+1:]...)
				break
			}
		}
		token := make([]byte, 16)
		if _, err := rand.Read(token); err != nil {
			return err
		}
		p.Grants = append(p.Grants, Grant{ID: hex.EncodeToString(token), Root: root, Access: access, Identity: identity})
		return nil
	})
}
func contains(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && (rel == "." || filepath.IsLocal(rel))
}
func (s *Store) blocked(path string) bool {
	for _, p := range s.protected {
		if contains(p, path) {
			return true
		}
	}
	return false
}
func Expand(path string) (string, error) {
	if strings.ContainsAny(path, "\x00\r\n") || len(path) > 4096 {
		return "", errors.New("invalid filesystem path")
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(path, "~"), "/"))
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("use an absolute filesystem path or ~/path")
	}
	return filepath.Clean(path), nil
}
func canonicalFolder(path string) (string, error) {
	path, err := Expand(path)
	if err != nil {
		return "", err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("permission scope must be an existing folder")
	}
	return path, nil
}
func Folder(path string) (string, string, error) {
	root, err := canonicalFolder(path)
	if err != nil {
		return "", "", err
	}
	identity, err := folderIdentity(root)
	return root, identity, err
}
