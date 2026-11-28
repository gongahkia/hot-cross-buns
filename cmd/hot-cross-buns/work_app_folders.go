package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/filenav"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"reflect"
)

func fileNavigation(store config.Store, id, source, op, path string) (filenav.State, error) {
	if op == "status" {
		settings, e := store.Load()
		if e != nil {
			return filenav.State{}, e
		}
		return settings.FileNavigation.State(id, source)
	}
	var result filenav.State
	e := store.Update(func(settings *config.Settings) error {
		var e error
		result, e = settings.FileNavigation.Change(id, source, op, path)
		return e
	})
	return result, e
}
func (c hotCrossBunsAppController) inspectFolders(id string) (any, error) {
	source := ""
	if c.request != nil {
		source = c.request.SourcePath
	}
	state, e := fileNavigation(c.settings, id, source, "status", "")
	if e != nil {
		return nil, e
	}
	return map[string]any{"navigation": state, "snapshot_workspace": source, "note": "Search root defaults to the user's home. Working folder is navigation context for this chat, not a snapshot of the entire search root. Reads and mutations retain existing filesystem permissions. Use absolute paths with filesystem and an explicit project path for code work. Folder metadata and recency are saved locally; no file contents are cached here."}, nil
}
func (c hotCrossBunsAppController) prepareFolder(change workrun.AppChange) (workrun.AppMutation, error) {
	var v struct {
		Action string `json:"action"`
		Path   string `json:"path"`
	}
	if e := workrun.DecodeAppArguments(change.Value, &v); e != nil {
		return workrun.AppMutation{}, e
	}
	if v.Action != "focus" && v.Action != "root" {
		return workrun.AppMutation{}, errors.New("folder action must be focus or root")
	}
	if change.ConversationID == "" {
		return workrun.AppMutation{}, errors.New("folder navigation needs a conversation")
	}
	prior, e := c.settings.Load()
	if e != nil {
		return workrun.AppMutation{}, e
	}
	var next filenav.Settings
	b, _ := json.Marshal(prior.FileNavigation)
	if e = json.Unmarshal(b, &next); e != nil {
		return workrun.AppMutation{}, e
	}
	source := ""
	if c.request != nil {
		source = c.request.SourcePath
	}
	state, e := next.Change(change.ConversationID, source, v.Action, v.Path)
	if e != nil {
		return workrun.AppMutation{}, e
	}
	canonical := state.Working
	if v.Action == "root" {
		canonical = state.Root
	}
	return workrun.AppMutation{Review: true, AfterRun: true, Summary: "File navigation folder saved for future requests.", Preview: map[string]any{"action": v.Action, "path": canonical, "effect": "Updates file search root or this chat's working folder after this reply. Does not read file contents, capture the root as a snapshot, execute programs, or grant filesystem permissions."}, Apply: func(ctx context.Context) (any, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		var result filenav.State
		e := c.settings.Update(func(s *config.Settings) error {
			if s.FileNavigation.Root != prior.FileNavigation.Root || !reflect.DeepEqual(s.FileNavigation.Folders, prior.FileNavigation.Folders) {
				return errors.New("file navigation changed during review; inspect folders again")
			}
			var e error
			result, e = s.FileNavigation.Change(change.ConversationID, source, v.Action, canonical)
			return e
		})
		return result, e
	}}, nil
}
