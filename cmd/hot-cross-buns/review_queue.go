package main

import (
	"errors"

	"github.com/gongahkia/hot-cross-buns/internal/state"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

func applyReviewQueue(stateDir string, action suggestion.QueueAction) (result suggestion.QueueResult) {
	result.RequestID = action.RequestID
	release, err := state.Guard(stateDir, false)
	if err != nil {
		result.Error = err.Error()
		return
	}
	defer release()
	store, err := suggestion.Open(stateDir)
	if err != nil {
		result.Error = err.Error()
		return
	}
	switch action.Action {
	case "list":
	case "inspect":
		var record suggestion.Record
		record, err = store.Load(action.ID)
		if err == nil {
			result.Review, err = inspectSuggestion(stateDir, record)
		}
	case "accept", "reject":
		_, err = store.ResolveRevision(action.ID, action.Action, action.Revision, func(record suggestion.Record) (string, error) {
			return applySuggestion(stateDir, record)
		})
		if err == nil {
			result.Notice = "Proposal rejected."
			if action.Action == "accept" {
				result.Notice = "Proposal accepted. Check Scheduled tasks for any activated schedule."
			}
		}
	default:
		err = errors.New("unsupported review queue action")
	}
	if err == nil {
		result.Entries, err = store.List("pending")
		if result.Entries == nil {
			result.Entries = []suggestion.Record{}
		}
	}
	if err != nil {
		result.Error = err.Error()
	}
	return
}
