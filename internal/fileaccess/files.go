package fileaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type Result struct {
	Path      string  `json:"path"`
	Operation string  `json:"operation"`
	Text      string  `json:"text,omitempty"`
	SHA256    string  `json:"sha256,omitempty"`
	Entries   []Entry `json:"entries,omitempty"`
	Truncated bool    `json:"truncated,omitempty"`
}
type Entry struct {
	Name      string `json:"name"`
	Directory bool   `json:"directory"`
	Symlink   bool   `json:"symlink,omitempty"`
}

func hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func (t *Task) open(path string) (*os.Root, string, error) {
	if err := t.Check(); err != nil {
		return nil, "", err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	var selected Grant
	for _, g := range t.grants {
		if contains(g.Root, path) && len(g.Root) > len(selected.Root) {
			selected = g
		}
	}
	if selected.Root == "" {
		return nil, "", errors.New("no current folder grant")
	}
	root, err := os.OpenRoot(selected.Root)
	if err != nil {
		return nil, "", err
	}
	info, err := root.Stat(".")
	if err != nil {
		root.Close()
		return nil, "", err
	}
	if identityInfo(info) != selected.Identity {
		root.Close()
		return nil, "", errors.New("approved folder was replaced")
	}
	rel, err := filepath.Rel(selected.Root, path)
	if err != nil {
		root.Close()
		return nil, "", err
	}
	return root, rel, nil
}
func read(root *os.Root, path string) ([]byte, os.FileInfo, error) {
	before, err := root.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() || before.Size() > MaxBytes {
		return nil, nil, errors.New("live reads require a regular file no larger than 1 MiB; symlinks and devices are unavailable")
	}
	file, err := root.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, nil, errors.New("file changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if len(data) > MaxBytes {
		return nil, nil, errors.New("file exceeds 1 MiB")
	}
	return data, opened, nil
}
func (t *Task) Execute(ctx context.Context, operation, path, content, expected, access, reason string) (Result, error) {
	write := operation == "write" || operation == "mkdir" || operation == "delete"
	if operation != "read" && operation != "list" && operation != "write" && operation != "mkdir" && operation != "delete" && operation != "request_access" {
		return Result{}, errors.New("unknown filesystem operation")
	}
	if operation != "request_access" {
		access = "read"
		if write {
			access = "write"
		}
	}
	if len(content) > MaxBytes || !utf8.ValidString(content) || strings.ContainsRune(content, 0) {
		return Result{}, errors.New("filesystem text must be UTF-8, contain no NUL and fit within 1 MiB")
	}
	if operation != "write" && content != "" {
		return Result{}, errors.New("only write accepts content")
	}
	target, err := t.Access(ctx, path, access, operation, reason)
	if err != nil {
		return Result{}, err
	}
	out := Result{Path: target, Operation: operation}
	if operation == "request_access" {
		return out, nil
	}
	root, rel, err := t.open(target)
	if err != nil {
		return out, err
	}
	defer root.Close()
	if err := ctx.Err(); err != nil {
		return out, err
	}
	switch operation {
	case "read":
		data, _, err := read(root, rel)
		if err != nil {
			return out, err
		}
		if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
			return out, errors.New("file is not UTF-8 text")
		}
		out.Text = string(data)
		out.SHA256 = hash(data)
	case "list":
		file, err := root.Open(rel)
		if err != nil {
			return out, err
		}
		defer file.Close()
		entries, err := file.ReadDir(257)
		if err != nil && !errors.Is(err, io.EOF) {
			return out, err
		}
		if len(entries) > 256 {
			entries = entries[:256]
			out.Truncated = true
		}
		out.Entries = []Entry{}
		for _, e := range entries {
			out.Entries = append(out.Entries, Entry{Name: e.Name(), Directory: e.IsDir(), Symlink: e.Type()&os.ModeSymlink != 0})
		}
	case "write":
		mode := os.FileMode(0600)
		before, statErr := root.Lstat(rel)
		if errors.Is(statErr, os.ErrNotExist) {
			if expected != "" {
				return out, errors.New("file no longer exists")
			}
		} else if statErr != nil {
			return out, statErr
		} else {
			data, info, err := read(root, rel)
			if err != nil {
				return out, err
			}
			if expected == "" || hash(data) != expected {
				return out, errors.New("existing file needs the exact SHA-256 from a fresh read; file was not changed")
			}
			mode = info.Mode().Perm()
		}
		token := make([]byte, 16)
		if _, err := rand.Read(token); err != nil {
			return out, err
		}
		temporary := filepath.Join(filepath.Dir(rel), ".hcb-"+hex.EncodeToString(token))
		file, err := root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return out, err
		}
		defer root.Remove(temporary)
		_, writeErr := file.WriteString(content)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return out, err
		}
		if err = t.Check(); err != nil {
			return out, err
		}
		if err = ctx.Err(); err != nil {
			return out, err
		}
		current, nowErr := root.Lstat(rel)
		if statErr == nil {
			data, _, err := read(root, rel)
			if err != nil || nowErr != nil || !os.SameFile(before, current) || hash(data) != expected {
				return out, errors.New("file changed before replacement; inspect again")
			}
		} else if !errors.Is(nowErr, os.ErrNotExist) {
			return out, errors.New("a file appeared at the create target; inspect again")
		}
		if statErr != nil {
			err = root.Link(temporary, rel)
		} else {
			err = root.Rename(temporary, rel)
		}
		if err != nil {
			return out, err
		}
		out.SHA256 = hash([]byte(content))
	case "mkdir":
		if err = t.Check(); err != nil {
			return out, err
		}
		if err = root.Mkdir(rel, 0700); err != nil {
			return out, err
		}
	case "delete":
		if rel == "." {
			return out, errors.New("cannot delete an approved folder root; grant its parent explicitly")
		}
		for _, protected := range t.store.protected {
			if contains(target, protected) {
				return out, errors.New("cannot delete a folder containing HCB control records")
			}
		}
		info, err := root.Lstat(rel)
		if err != nil {
			return out, err
		}
		if info.IsDir() {
			if expected != "" {
				return out, errors.New("directory deletion accepts only an empty expected_sha256 and removes empty folders only")
			}
		} else {
			data, _, err := read(root, rel)
			if err != nil {
				return out, err
			}
			if expected == "" || hash(data) != expected {
				return out, errors.New("deletion needs the exact SHA-256 from a fresh read")
			}
		}
		if err = t.Check(); err != nil {
			return out, err
		}
		if err = ctx.Err(); err != nil {
			return out, err
		}
		if err = root.Remove(rel); err != nil {
			return out, err
		}
	}
	if err = t.Check(); err != nil {
		return out, fmt.Errorf("permission changed while operation ran; inspect actual state before retrying: %w", err)
	}
	return out, nil
}
