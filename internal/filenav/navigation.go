// Package filenav stores navigation metadata, separately from task snapshots and permissions.
package filenav

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Recent struct {
	Path string    `json:"path"`
	At   time.Time `json:"at"`
}
type Settings struct {
	Root          string            `json:"root,omitempty"`
	Folders       map[string]string `json:"folders,omitempty"`
	RecentFolders []Recent          `json:"recent_folders,omitempty"`
	RecentFiles   []Recent          `json:"recent_files,omitempty"`
}
type State struct {
	Root          string   `json:"root"`
	Working       string   `json:"working"`
	RecentFolders []Recent `json:"recent_folders"`
	RecentFiles   []Recent `json:"recent_files"`
}

func Canonical(path string) (string, error) {
	if strings.HasPrefix(path, "~/") {
		home, e := os.UserHomeDir()
		if e != nil {
			return "", e
		}
		path = filepath.Join(home, path[2:])
	}
	if !filepath.IsAbs(path) || len(path) > 8192 || strings.ContainsAny(path, "\x00\r\n") {
		return "", errors.New("provide an absolute folder or ~/path")
	}
	p, e := filepath.EvalSymlinks(path)
	if e != nil {
		return "", e
	}
	f, e := os.Open(p)
	if e != nil {
		return "", e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.IsDir() {
		return "", errors.New("choose a readable folder")
	}
	return p, nil
}
func Inside(root, path string) bool {
	relative, e := filepath.Rel(root, path)
	return e == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}
func (s Settings) State(id, fallback string) (State, error) {
	root := s.Root
	if root == "" {
		root, _ = os.UserHomeDir()
	}
	root, e := Canonical(root)
	if e != nil {
		return State{}, e
	}
	working := s.Folders[id]
	if working == "" {
		working = root
	}
	if working == "" || !Inside(root, working) {
		working = root
	}
	return State{Root: root, Working: working, RecentFolders: s.RecentFolders, RecentFiles: s.RecentFiles}, nil
}
func remember(items []Recent, path string) []Recent {
	next := []Recent{{path, time.Now().UTC()}}
	for _, v := range items {
		if v.Path != path && len(next) < 50 {
			next = append(next, v)
		}
	}
	return next
}
func (s *Settings) Change(id, fallback, op, path string) (State, error) {
	state, e := s.State(id, fallback)
	if e != nil {
		return State{}, e
	}
	switch op {
	case "status":
		return state, nil
	case "focus", "root":
		p, e := Canonical(path)
		if e != nil {
			return State{}, e
		}
		if op == "root" {
			s.Root = p
		} else {
			if !Inside(state.Root, p) {
				return State{}, errors.New("folder is outside the search root; explicitly change the search root first")
			}
			if len(s.Folders) >= 128 && s.Folders[id] == "" {
				return State{}, errors.New("too many saved working folders")
			}
			if s.Folders == nil {
				s.Folders = map[string]string{}
			}
			s.Folders[id] = p
		}
		s.RecentFolders = remember(s.RecentFolders, p)
	case "recent-file":
		if !filepath.IsAbs(path) || !Inside(state.Root, path) {
			return State{}, errors.New("file is outside search root")
		}
		s.RecentFiles = remember(s.RecentFiles, path)
	default:
		return State{}, errors.New("unknown file navigation action")
	}
	return s.State(id, fallback)
}
