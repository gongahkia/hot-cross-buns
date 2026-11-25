package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

func routineControl(ctx context.Context, stateDir, action string, args []string) (workapp.ControlScreen, error) {
	if err := ctx.Err(); err != nil {
		return workapp.ControlScreen{}, err
	}
	release, err := state.Guard(stateDir, false)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	defer release()
	store, err := knowledge.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	notice := ""
	if action == "enable" || action == "disable" {
		if len(args) != 2 {
			return workapp.ControlScreen{}, errors.New("inspect one procedure before changing it")
		}
		if _, err := store.SetSkillEnabledReviewed(args[0], args[1], action == "enable"); err != nil {
			return workapp.ControlScreen{}, err
		}
		notice = "Availability updated for future activations. Already active work retains its reviewed version; cancel that work to stop it."
		action, args = "status", nil
	}
	if action == "inspect" {
		if len(args) != 2 {
			return workapp.ControlScreen{}, errors.New("choose a procedure from the current library")
		}
		skill, err := store.LoadSkill(args[0])
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		if skill.Revision() != args[1] {
			return workapp.ControlScreen{}, errors.New("procedure changed; refresh the library and select it again")
		}
		state := "Enabled"
		operation := "disable"
		label := "Disable for future tasks"
		if !skill.Enabled {
			state = "Disabled"
			operation = "enable"
			label = "Enable for future tasks"
		}
		blocks := []uisnapshot.Block{{Title: "Procedure", Lines: strings.Split(skill.Body, "\n")}}
		if r := skill.Routine; r != nil {
			blocks = append(blocks, uisnapshot.Block{Title: "Source prerequisites", Lines: r.Sources}, uisnapshot.Block{Title: "Allowed future effects and limits", Lines: []string{strings.Join(r.Effects, ", "), fmt.Sprintf("%d additional HCB model requests · %d reported tokens; existing lower limits apply. CLI workers retain separate limits.", r.MaxRequests, r.MaxTokens)}})
			parameters := []string{}
			for _, p := range r.Parameters {
				parameters = append(parameters, p.Name+": "+p.Description)
			}
			if len(parameters) > 0 {
				blocks = append(blocks, uisnapshot.Block{Title: "Parameters", Lines: parameters})
			}
		}
		blocks = append(blocks, uisnapshot.Block{Title: "Availability", Lines: []string{state, "Using a parameterized routine requires fresh review in its task. Separate file, app, browser and account permissions still apply."}})
		return workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "routines", Title: skill.ID, Subtitle: state + " · " + skill.Description, Blocks: blocks}, Actions: []workapp.ControlAction{{Key: "B", Label: "All skills and routines", Action: "status"}, {Key: "E", Label: label, Action: operation, Args: []string{skill.ID, skill.Revision()}, Review: true, Description: "Change this exact saved definition's availability for future tasks. This does not execute it, grant permissions or stop already active work."}}}, nil
	}
	if action != "status" || len(args) != 0 {
		return workapp.ControlScreen{}, errors.New("unknown routine library action")
	}
	skills, err := store.ListSkills(false)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	screen := workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "routines", Title: "Skills and routines", Subtitle: "Saved procedures you can inspect and reuse.", Notice: notice, Blocks: []uisnapshot.Block{{Lines: []string{"Ask HCB to use a routine by name with its parameter values. Review the expanded procedure before it runs. Saving or enabling a routine does not schedule it or grant access."}}}}}
	if len(skills) == 0 {
		screen.Panel.Blocks = append(screen.Panel.Blocks, uisnapshot.Block{Lines: []string{"No saved procedures yet. Ask HCB to save a useful workflow as a routine, then review its proposal."}})
	}
	for i, listed := range skills {
		// ListSkills omits procedure bodies; pin the complete current revision.
		skill, err := store.LoadSkill(listed.ID)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		state := "Enabled"
		if !skill.Enabled {
			state = "Disabled"
		}
		if skill.Routine != nil {
			state += " · routine"
		}
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: fmt.Sprint(i + 1), Label: skill.ID, Detail: state + " · " + skill.Description, Action: "inspect", Args: []string{skill.ID, skill.Revision()}})
	}
	screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "R", Label: "Refresh", Action: "status"})
	return screen, nil
}
