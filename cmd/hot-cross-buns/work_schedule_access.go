package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func (c hotCrossBunsAppController) prepareScheduledAccess(ctx context.Context, next *jobs.Definition, change scheduleChange) ([]string, string, error) {
	if change.Action == "pause" || change.Action == "cancel" {
		return nil, "stopping", nil
	}
	settings, err := c.settings.Load()
	if err != nil {
		return nil, "", err
	}
	if change.Mode != nil {
		if *change.Mode != action.Inspect && *change.Mode != action.Draft {
			return nil, "", errors.New("scheduled work can inspect or prepare drafts; external actions require foreground review")
		}
		next.Mode = *change.Mode
		if next.Mode == action.Draft {
			next.Contract = artifact.OptionalDraftContract()
		} else {
			next.Contract = artifact.InspectionContract()
		}
	}
	if change.Limits != nil {
		if change.Limits.ModelRequests < 1 || change.Limits.ModelRequests > 128 || change.Limits.Tokens < 1000 || change.Limits.Tokens > 1000000 || change.Limits.WallSeconds < 1 || change.Limits.WallSeconds > 3600 {
			return nil, "", errors.New("choose bounded per-run requests (1–128), tokens (1000–1000000) and seconds (1–3600)")
		}
		next.Limits = *change.Limits
	}
	if change.ConnectorIDs != nil {
		for _, id := range *change.ConnectorIDs {
			if !slices.Contains(next.ConnectorIDs, id) && !slices.Contains(c.request.ConnectorIDs, id) {
				return nil, "", fmt.Errorf("select connection %s for this task before scheduling its access", id)
			}
		}
		next.ConnectorIDs = append([]string{}, (*change.ConnectorIDs)...)
	}
	if change.ReadOperations != nil {
		next.ReadOperations = *change.ReadOperations
	}
	registry, err := connector.NewRegistry(settings.Connectors)
	if err != nil {
		return nil, "", err
	}
	credentials, err := auth.New(c.stateDir)
	if err != nil {
		return nil, "", err
	}
	var sources []connector.Descriptor
	lines := []string{"Execution: " + string(next.Mode) + "; sending, publishing and app control require separate foreground approval."}
	if change.ConnectorIDs != nil || change.ReadOperations != nil {
		next.CredentialPins = map[string]string{}
		for _, id := range next.ConnectorIDs {
			d, found := registry.Get(id)
			if !found {
				return nil, "", fmt.Errorf("connection %s is no longer configured", id)
			}
			if len(next.ReadOperations[id]) == 0 {
				return nil, "", fmt.Errorf("choose explicit read_operations for connection %s", id)
			}
			for _, name := range next.ReadOperations[id] {
				_, op, err := registry.Operation(id, name)
				if err != nil || op.Capability != action.ConnectedRead || connector.PermissionSet(settings.ConnectorPermissions).Resolve(id, name, op.Capability) != connector.PermissionAllow {
					return nil, "", fmt.Errorf("%s/%s needs an available, allowed read operation; repair access in Connections", id, name)
				}
			}
			credential, found, err := credentials.Read(d.CredentialRef())
			if err != nil || d.Authentication != connector.AuthNone && !found {
				return nil, "", fmt.Errorf("sign in to %s before scheduling access", id)
			}
			next.CredentialPins[id] = connector.CredentialPin(d, credential)
		}
		pins, err := captureGoalOAuthAccountPins(ctx, next.ConnectorIDs, registry, credentials)
		if err != nil {
			return nil, "", err
		}
		next.OAuthAccountPins, next.OAuthRefreshPins = pins, nil
	}
	for _, id := range next.ConnectorIDs {
		d, found := registry.Get(id)
		if !found {
			if change.ConnectorIDs != nil || change.ReadOperations != nil {
				return nil, "", fmt.Errorf("connection %s is unavailable", id)
			}
			lines = append(lines, "Saved source unavailable: "+id)
			continue
		}
		sources = append(sources, d)
		lines = append(lines, fmt.Sprintf("Account: %s · read operations: %v", d.Name, next.ReadOperations[id]))
	}
	if change.ClearRoutine {
		if change.Routine != nil {
			return nil, "", errors.New("choose a routine or clear_routine, not both")
		}
		next.Routine = nil
	}
	if change.Routine != nil {
		next.Routine = change.Routine
	}
	if next.Routine != nil {
		store, err := knowledge.Open(c.stateDir)
		if err != nil {
			return nil, "", err
		}
		skill, procedure, err := workrun.ResolveScheduledRoutine(store, *next.Routine, next.Mode)
		if err != nil {
			return nil, "", err
		}
		lines = append(lines, "Routine: "+skill.ID+" · "+skill.Revision(), "Procedure: "+procedure)
	}
	lines = append(lines, "Notify when: "+next.AlertWhen, fmt.Sprintf("Budget: %d requests · %d tokens · %d seconds per run", next.Limits.ModelRequests, next.Limits.Tokens, next.Limits.WallSeconds))
	data, _ := json.Marshal([]any{sources, settings.ConnectorPermissions, next.CredentialPins, next.OAuthAccountPins, next.ReadOperations, next.Routine})
	return lines, fmt.Sprintf("%x", sha256.Sum256(data)), nil
}
