// Package mcpaccess owns explicit, revocable grants for exact trusted MCP bundles.
package mcpaccess

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
	"os"
	"path/filepath"
)

type Scope struct {
	Repository string `json:"repository"`
	Hash       string `json:"bundle_sha256"`
	Server     string `json:"server"`
}
type Review struct {
	Connection Scope           `json:"connection"`
	Tool       string          `json:"tool"`
	Arguments  json.RawMessage `json:"arguments"`
	ReadOnly   bool            `json:"declared_read_only"`
}
type Policy struct {
	Version  int     `json:"version"`
	Revision uint64  `json:"revision"`
	Grants   []Scope `json:"grants"`
}

func (p Policy) Allows(s Scope) bool {
	for _, g := range p.Grants {
		if g == s {
			return true
		}
	}
	return false
}
func ValidChoice(s string) bool { return s == "once" || s == "always" }

var ErrChanged = errors.New("MCP permissions changed; review this call again")

type Store struct{ directory string }

func Open(state string) (Store, error) {
	if !filepath.IsAbs(state) {
		return Store{}, errors.New("MCP permission storage must be absolute")
	}
	s := Store{filepath.Join(state, "hot-cross-buns", "mcp-permissions")}
	return s, privatefs.MkdirAll(s.directory)
}
func (s Store) lock() (func(), error) {
	r, e := os.OpenRoot(s.directory)
	if e != nil {
		return nil, e
	}
	f, e := filelock.OpenRootFile(r, ".lock", os.O_CREATE|os.O_RDWR, 0600)
	r.Close()
	if e != nil {
		return nil, e
	}
	if e = filelock.Lock(f, filelock.Exclusive); e != nil {
		f.Close()
		return nil, e
	}
	return func() { filelock.Unlock(f); f.Close() }, nil
}
func (s Store) load() (Policy, error) {
	r, e := workspace.Open(s.directory)
	if e != nil {
		return Policy{}, e
	}
	b, e := r.ReadRegularFile("permissions.json", 128*1024)
	if errors.Is(e, os.ErrNotExist) {
		return Policy{Version: 1, Revision: 1}, nil
	}
	if e != nil {
		return Policy{}, e
	}
	var p Policy
	if json.Unmarshal(b, &p) != nil || p.Version != 1 || p.Revision == 0 || len(p.Grants) > 256 {
		return Policy{}, errors.New("invalid MCP permission policy")
	}
	return p, nil
}
func (s Store) write(p Policy) error {
	r, e := workspace.Open(s.directory)
	if e != nil {
		return e
	}
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	return r.WriteRegularFileAtomic("permissions.json", b, 128*1024)
}
func (s Store) Get() (Policy, error) {
	release, e := s.lock()
	if e != nil {
		return Policy{}, e
	}
	defer release()
	return s.load()
}
func (s Store) Revoke(revision uint64, scope Scope) error {
	release, e := s.lock()
	if e != nil {
		return e
	}
	defer release()
	p, e := s.load()
	if e != nil {
		return e
	}
	if p.Revision != revision || revision == ^uint64(0) {
		return ErrChanged
	}
	next := []Scope{}
	for _, g := range p.Grants {
		if g != scope {
			next = append(next, g)
		}
	}
	p.Grants = next
	p.Revision++
	return s.write(p)
}

// Apply serializes admission with revocation. An in-flight call finishes first;
// revocation blocks subsequent calls and invalidates pending reviews.
func (s Store) Apply(ctx context.Context, revision uint64, scope Scope, choice string, call func() (any, error)) (any, error) {
	release, e := s.lock()
	if e != nil {
		return nil, e
	}
	defer release()
	p, e := s.load()
	if e != nil {
		return nil, e
	}
	if p.Revision != revision || revision == ^uint64(0) {
		return nil, ErrChanged
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	if !filepath.IsAbs(scope.Repository) || scope.Hash == "" || scope.Server == "" || call == nil {
		return nil, errors.New("invalid MCP permission scope")
	}
	if choice != "" && !ValidChoice(choice) || !p.Allows(scope) && !ValidChoice(choice) {
		return nil, errors.New("MCP call needs permission")
	}
	if choice == "always" && !p.Allows(scope) {
		if len(p.Grants) >= 256 {
			return nil, errors.New("too many saved MCP grants")
		}
		p.Grants = append(p.Grants, scope)
		p.Revision++
		if e = s.write(p); e != nil {
			return nil, e
		}
	}
	return call()
}
