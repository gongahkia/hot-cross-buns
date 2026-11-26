package main

import (
	"context"
	"errors"
	"reflect"
	"slices"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

var assignableSpecialists = []string{"source_researcher", "artifact_reviewer", "connected_researcher", "spreadsheet_analyst", "claim_verifier", "goal_reviewer"}

func (c hotCrossBunsAppController) prepareSpecialistModel(change workrun.AppChange) (workrun.AppMutation, error) {
	var in struct {
		Role     string `json:"role"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
		MaxSteps int    `json:"max_steps"`
		Inherit  bool   `json:"inherit"`
	}
	if err := workrun.DecodeAppArguments(change.Value, &in); err != nil {
		return workrun.AppMutation{}, err
	}
	if !slices.Contains(assignableSpecialists, in.Role) || in.MaxSteps < 1 || in.MaxSteps > 32 {
		return workrun.AppMutation{}, errors.New("choose a native specialist role and a 1–32 step limit; CLI coding agents retain their separate local login and configuration")
	}
	prior, err := c.settings.Load()
	if err != nil {
		return workrun.AppMutation{}, err
	}
	selected := config.Defaults{Provider: in.Provider, Model: in.Model}
	if in.Inherit {
		if in.Provider != "" || in.Model != "" {
			return workrun.AppMutation{}, errors.New("inherit accepts no provider/model override")
		}
	} else if !knownAppModel(prior, selected) {
		return workrun.AppMutation{}, errors.New("select an allowed configured provider/model from Models first")
	}
	next := config.WorkRole{Version: 1, Name: in.Role, Provider: in.Provider, Model: in.Model, MaxSteps: in.MaxSteps}
	return workrun.AppMutation{Review: true, AfterRun: true, Summary: "Specialist model assignment saved for future tasks.", Preview: map[string]any{"role": in.Role, "before": prior.WorkRoles, "after": next, "effect": "Future tasks only. Existing runs and captured reviews keep their model scope. Subsequent scheduled runs use current specialist assignments while keeping their reviewed account and tool scope. Provider credentials, local Codex CLI authentication, tool permissions and shared usage limits stay unchanged."}, Apply: func(context.Context) (any, error) {
		err := c.settings.Update(func(current *config.Settings) error {
			if !reflect.DeepEqual(current.WorkRoles, prior.WorkRoles) || !in.Inherit && !knownAppModel(*current, selected) {
				return errors.New("specialist or model configuration changed; inspect and review again")
			}
			for i, role := range current.WorkRoles {
				if role.Name == in.Role {
					current.WorkRoles[i] = next
					return nil
				}
			}
			current.WorkRoles = append(current.WorkRoles, next)
			return nil
		})
		return next, err
	}}, nil
}
