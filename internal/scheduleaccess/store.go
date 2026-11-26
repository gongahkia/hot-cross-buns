// Package scheduleaccess owns permission to manage scheduled tasks. It never
// grants the tools, account access or external effects of a scheduled run.
package scheduleaccess

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

var ErrChanged = errors.New("scheduling permissions changed; inspect and review the action again")

type Policy struct {
	Version  int    `json:"version"`
	Revision uint64 `json:"revision"`
	Always   bool   `json:"always_allow"`
}
type Review struct {
	Action string   `json:"action"`
	Title  string   `json:"title"`
	Lines  []string `json:"agreement"`
}

func ValidChoice(choice string) bool { return choice == "once" || choice == "always" }

type Store struct{ directory string }

func Open(stateDir string) (Store, error) {
	if !filepath.IsAbs(stateDir) {
		return Store{}, errors.New("scheduling permission storage must be absolute")
	}
	s := Store{filepath.Join(stateDir, "hot-cross-buns", "schedule-permissions")}
	return s, privatefs.MkdirAll(s.directory)
}
func (s Store) lock() (func(), error) {
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return nil, err
	}
	file, err := filelock.OpenRootFile(root, ".lock", os.O_CREATE|os.O_RDWR, 0600)
	root.Close()
	if err != nil {
		return nil, err
	}
	if err := filelock.Lock(file, filelock.Exclusive); err != nil {
		file.Close()
		return nil, err
	}
	return func() { _ = filelock.Unlock(file); _ = file.Close() }, nil
}
func (s Store) load() (Policy, error) {
	root, err := workspace.Open(s.directory)
	if err != nil {
		return Policy{}, err
	}
	data, err := root.ReadRegularFile("permissions.json", 4096)
	if errors.Is(err, os.ErrNotExist) {
		return Policy{Version: 1, Revision: 1}, nil
	}
	if err != nil {
		return Policy{}, err
	}
	var p Policy
	if json.Unmarshal(data, &p) != nil || p.Version != 1 || p.Revision == 0 {
		return Policy{}, errors.New("invalid scheduling permission policy")
	}
	return p, nil
}
func (s Store) write(p Policy) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	root, err := workspace.Open(s.directory)
	if err != nil {
		return err
	}
	return root.WriteRegularFileAtomic("permissions.json", data, 4096)
}
func (s Store) Get() (Policy, error) {
	release, err := s.lock()
	if err != nil {
		return Policy{}, err
	}
	defer release()
	return s.load()
}
func (s Store) Set(revision uint64, always bool) (Policy, error) {
	release, err := s.lock()
	if err != nil {
		return Policy{}, err
	}
	defer release()
	p, err := s.load()
	if err != nil {
		return p, err
	}
	if p.Revision != revision || revision == ^uint64(0) {
		return p, ErrChanged
	}
	p.Revision++
	p.Always = always
	return p, s.write(p)
}

// Apply binds an exact mutation to the reviewed policy revision. Revocation
// while a review is pending blocks it. Revocation during an authorized mutation
// takes effect after that mutation finishes. An always choice also authorizes
// future changes even if this particular target can no longer be changed.
func (s Store) Apply(ctx context.Context, revision uint64, choice string, apply func() (any, error)) (any, error) {
	release, err := s.lock()
	if err != nil {
		return nil, err
	}
	defer release()
	p, err := s.load()
	if err != nil {
		return nil, err
	}
	if p.Revision != revision || revision == ^uint64(0) {
		return nil, ErrChanged
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !p.Always && !ValidChoice(choice) {
		return nil, errors.New("this schedule change needs an inline permission review")
	}
	if choice != "" && !ValidChoice(choice) {
		return nil, errors.New("invalid scheduling permission choice")
	}
	if apply == nil {
		return nil, errors.New("missing schedule mutation")
	}
	if choice == "always" && !p.Always {
		p.Always = true
		p.Revision++
		if err := s.write(p); err != nil {
			return nil, err
		}
	}
	return apply()
}
