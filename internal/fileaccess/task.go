package fileaccess

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
)

type Review struct {
	Folder           string `json:"folder"`
	Path             string `json:"requested_path"`
	Access           string `json:"access"`
	Operation        string `json:"operation"`
	Reason           string `json:"reason"`
	Revision         uint64 `json:"policy_revision"`
	Identity         string `json:"folder_identity"`
	FullAccessNotice string `json:"full_access_notice"`
}
type Decide func(context.Context, Review) (string, error)
type Task struct {
	mu       sync.Mutex
	store    *Store
	revision uint64
	epoch    atomic.Uint64
	full     bool
	grants   []Grant
	decide   Decide
	readOnly bool
}
type Envelope struct {
	Full      bool     `json:"full_access"`
	Read      []string `json:"read"`
	Write     []string `json:"write"`
	Protected []string `json:"protected"`
	Digest    string   `json:"digest"`
}

func NewTask(store *Store, readOnly bool, decide Decide) (*Task, error) {
	p, err := store.Get()
	if err != nil {
		return nil, err
	}
	task := &Task{store: store, revision: p.Revision, decide: decide, readOnly: readOnly, full: p.Full}
	task.epoch.Store(p.Revision)
	return task, nil
}
func ValidChoice(choice string) bool {
	return choice == "once" || choice == "always" || choice == "full"
}
func (t *Task) Check() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	p, err := t.store.Get()
	if err != nil {
		return err
	}
	if p.Revision != t.revision {
		return ErrChanged
	}
	for _, g := range t.grants {
		identity, err := folderIdentity(g.Root)
		if err != nil || identity != g.Identity {
			return errors.New("approved folder was moved or replaced")
		}
	}
	return nil
}
func (t *Task) Access(ctx context.Context, path, access, operation, reason string) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if access != "read" && access != "write" {
		return "", errors.New("invalid access")
	}
	if access == "write" && t.readOnly {
		return "", errors.New("this task is read-only; request an editing task before changing live files")
	}
	target, err := Expand(path)
	if err != nil {
		return "", err
	}
	// Resolve the existing parent first, keeping the final component unfollowed.
	parent := filepath.Dir(target)
	tail := filepath.Base(target)
	for {
		canonical, resolveErr := filepath.EvalSymlinks(parent)
		if resolveErr == nil {
			target = filepath.Join(canonical, tail)
			break
		}
		if !errors.Is(resolveErr, os.ErrNotExist) || parent == filepath.Dir(parent) {
			return "", resolveErr
		}
		tail = filepath.Join(filepath.Base(parent), tail)
		parent = filepath.Dir(parent)
	}
	if t.store.blocked(target) {
		return "", errors.New("HCB permission, credential and execution records are outside live filesystem tools")
	}
	p, err := t.store.Get()
	if err != nil {
		return "", err
	}
	if p.Revision != t.revision {
		return "", ErrChanged
	}
	matches := func(g Grant) bool { return contains(g.Root, target) && (access == "read" || g.Access == "write") }
	remember := func(g Grant) error {
		identity, err := folderIdentity(g.Root)
		if err != nil || identity != g.Identity {
			return errors.New("approved folder changed; revoke it and review again")
		}
		for _, old := range t.grants {
			if old.Root == g.Root && old.Access == g.Access {
				return nil
			}
		}
		t.grants = append(t.grants, g)
		return nil
	}
	for _, g := range append(append([]Grant(nil), t.grants...), p.Grants...) {
		if matches(g) {
			return target, remember(g)
		}
	}
	folder := target
	info, statErr := os.Lstat(folder)
	if statErr != nil || !info.IsDir() {
		folder = filepath.Dir(folder)
	}
	for {
		if info, err := os.Stat(folder); err == nil && info.IsDir() {
			break
		}
		if folder == filepath.Dir(folder) {
			return "", errors.New("no existing parent folder")
		}
		folder = filepath.Dir(folder)
	}
	folder, identity, err := Folder(folder)
	if err != nil {
		return "", err
	}
	if p.Full {
		return target, remember(Grant{Root: folder, Identity: identity, Access: access})
	}
	if folder == string(filepath.Separator) {
		return "", errors.New("select full filesystem access in Settings before operating at the filesystem root")
	}
	if t.decide == nil {
		return "", errors.New("live filesystem access requires a foreground permission review")
	}
	choice, err := t.decide(ctx, Review{Folder: folder, Path: target, Access: access, Operation: operation, Reason: reason, Revision: p.Revision, Identity: identity, FullAccessNotice: "Allow once shares this folder for this task and its delegates. Always saves this folder's requested access. Full filesystem access saves read/create/update/delete permission across the accessible filesystem for future tasks; HCB control records remain protected. OS permissions still apply."})
	if err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if !ValidChoice(choice) {
		return "", errors.New("filesystem permission denied")
	}
	current, err := t.store.Get()
	if err != nil {
		return "", err
	}
	if current.Revision != p.Revision {
		return "", ErrChanged
	}
	actual, err := folderIdentity(folder)
	if err != nil || actual != identity {
		return "", errors.New("folder changed during permission review")
	}
	switch choice {
	case "always":
		current, err = t.store.Add(p.Revision, folder, access, identity)
	case "full":
		current, err = t.store.SetFull(p.Revision, true)
	}
	if err != nil {
		return "", err
	}
	t.revision = current.Revision
	t.epoch.Store(current.Revision)
	t.full = current.Full
	return target, remember(Grant{Root: folder, Access: access, Identity: identity})
}
func (t *Task) Envelope() (Envelope, error) {
	if err := t.Check(); err != nil {
		return Envelope{}, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e := Envelope{Read: []string{}, Write: []string{}, Protected: t.store.Protected(), Full: t.full}
	for _, g := range t.grants {
		e.Read = append(e.Read, g.Root)
		if g.Access == "write" && !t.readOnly {
			e.Write = append(e.Write, g.Root)
		}
	}
	sort.Strings(e.Read)
	sort.Strings(e.Write)
	data, _ := json.Marshal(struct {
		Revision uint64
		Envelope Envelope
	}{t.revision, e})
	hash := sha256.Sum256(data)
	e.Digest = hex.EncodeToString(hash[:])
	return e, nil
}

// CheckPolicy does not wait on an in-progress permission prompt. Worker
// cancellation must remain available while another tool awaits the user.
func (t *Task) CheckPolicy() error {
	p, err := t.store.Get()
	if err != nil {
		return err
	}
	if p.Revision != t.epoch.Load() {
		return ErrChanged
	}
	return nil
}
