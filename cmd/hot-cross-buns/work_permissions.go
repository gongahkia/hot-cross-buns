package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

func permissionControl(ctx context.Context, stateDir, operation string, args []string) (workapp.ControlScreen, error) {
	if err := ctx.Err(); err != nil {
		return workapp.ControlScreen{}, err
	}
	settings, err := config.DefaultStore()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	store, err := fileaccess.Open(stateDir, filepath.Dir(settings.Path()))
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	notice := ""
	scheduling, err := scheduleaccess.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	if strings.HasPrefix(operation, "schedule-") {
		if len(args) != 1 || operation != "schedule-ask" && operation != "schedule-always" {
			return workapp.ControlScreen{}, errors.New("refresh scheduling permissions before editing")
		}
		revision, parseErr := strconv.ParseUint(args[0], 10, 64)
		if parseErr != nil {
			return workapp.ControlScreen{}, parseErr
		}
		if _, err := scheduling.Set(revision, operation == "schedule-always"); err != nil {
			return workapp.ControlScreen{}, err
		}
		notice = "Scheduling permissions updated. Existing tasks retain their saved schedules and execution permissions."
		operation = "status"
		args = nil
	}
	mcpStore, err := mcpaccess.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	if operation == "mcp-revoke" {
		if len(args) != 4 {
			return workapp.ControlScreen{}, errors.New("refresh MCP permissions before revoking")
		}
		revision, e := strconv.ParseUint(args[0], 10, 64)
		if e != nil {
			return workapp.ControlScreen{}, e
		}
		if e = mcpStore.Revoke(revision, mcpaccess.Scope{Repository: args[1], Hash: args[2], Server: args[3]}); e != nil {
			return workapp.ControlScreen{}, e
		}
		notice = "MCP always-allow permission revoked. Calls already admitted may finish."
		operation = "status"
		args = nil
	}
	if operation != "status" {
		if len(args) < 1 {
			return workapp.ControlScreen{}, errors.New("refresh permissions before editing")
		}
		revision, err := strconv.ParseUint(args[0], 10, 64)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		switch operation {
		case "preview-scheduled":
			if len(args) != 3 {
				return workapp.ControlScreen{}, errors.New("choose a folder and scheduled task")
			}
			policy, err := store.Get()
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			if policy.Revision != revision {
				return workapp.ControlScreen{}, fileaccess.ErrChanged
			}
			root, identity, err := fileaccess.Folder(args[1])
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			jobStore, err := jobs.Open(stateDir)
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			job, err := jobStore.Load(args[2])
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			digest, err := job.CheckPolicyDigest()
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			lines := []string{"Scheduled task: " + job.Name, "Task: " + job.Objective, "When: " + job.Timing(), "Folder: " + root, "Access: read files and list folders only. Foreground/full permissions are separate. No file changes, desktop access or CLI workers are granted.", "Applies only to this task definition until revoked. Changing the task requires a new grant. Pausing blocks access; resuming the unchanged task retains this grant. File contents may enter the selected model and task history."}
			return workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "confirmation", Title: "Review scheduled folder reads", Blocks: []uisnapshot.Block{{Lines: lines}}}, Actions: []workapp.ControlAction{{Key: "A", Label: "Allow scheduled reads", Action: "save-scheduled", Args: []string{args[0], root, identity, job.ID, digest}}, {Key: "B", Label: "Cancel", Action: "status"}}}, nil
		case "save-scheduled":
			if len(args) != 5 {
				return workapp.ControlScreen{}, errors.New("review the scheduled folder again")
			}
			jobStore, loadErr := jobs.Open(stateDir)
			if loadErr != nil {
				return workapp.ControlScreen{}, loadErr
			}
			job, loadErr := jobStore.Load(args[3])
			if loadErr != nil {
				return workapp.ControlScreen{}, loadErr
			}
			digest, loadErr := job.CheckPolicyDigest()
			if loadErr != nil {
				return workapp.ControlScreen{}, loadErr
			}
			if digest != args[4] {
				return workapp.ControlScreen{}, errors.New("scheduled task changed; review its folder access again")
			}
			_, err = store.AddScheduled(revision, args[1], args[2], args[3], args[4])
			notice = "Read-only folder access saved for this scheduled task. Other tasks receive no access."
		case "preview":
			if len(args) != 3 {
				return workapp.ControlScreen{}, errors.New("choose a folder and its access")
			}
			policy, err := store.Get()
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			if policy.Revision != revision {
				return workapp.ControlScreen{}, fileaccess.ErrChanged
			}
			root, identity, err := fileaccess.Folder(args[1])
			if err != nil {
				return workapp.ControlScreen{}, err
			}
			if args[2] != "read" && args[2] != "write" {
				return workapp.ControlScreen{}, errors.New("choose read or write access")
			}
			access := "Read files and list folders"
			if args[2] == "write" {
				access = "Read, create, replace and delete live files"
			}
			return workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "confirmation", Title: "Review folder permission", Blocks: []uisnapshot.Block{{Lines: []string{"Folder: " + root, "Access: " + access, "Duration: saved until revoked; available to foreground tasks and their delegated workers. File contents may be sent to the selected model.", "Permission changes invalidate current filesystem access. HCB control records remain protected."}}}}, Actions: []workapp.ControlAction{{Key: "A", Label: "Save folder permission", Action: "save", Args: []string{args[0], root, args[2], identity}}, {Key: "B", Label: "Cancel", Action: "status"}}}, nil
		case "save":
			if len(args) != 4 {
				return workapp.ControlScreen{}, errors.New("review this folder again")
			}
			_, err = store.Add(revision, args[1], args[2], args[3])
			notice = "Folder permission saved. New tasks can use it without another prompt."
		case "full-on", "full-off":
			if len(args) != 1 {
				return workapp.ControlScreen{}, errors.New("refresh permissions")
			}
			_, err = store.SetFull(revision, operation == "full-on")
			notice = "Filesystem access setting updated. Current filesystem grants are invalidated."
		case "revoke":
			if len(args) != 2 {
				return workapp.ControlScreen{}, errors.New("choose one saved grant")
			}
			_, err = store.Revoke(revision, args[1])
			notice = "Folder permission revoked. Active delegated filesystem workers are stopped when revocation is observed."
		case "revoke-all":
			if len(args) != 1 {
				return workapp.ControlScreen{}, errors.New("refresh permissions")
			}
			_, err = store.RevokeAll(revision)
			notice = "Full access and saved folder permissions revoked."
		default:
			return workapp.ControlScreen{}, errors.New("unknown permission operation")
		}
		if err != nil {
			return workapp.ControlScreen{}, err
		}
	} else if len(args) != 0 {
		return workapp.ControlScreen{}, errors.New("unexpected permission arguments")
	}
	policy, err := store.Get()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	revision := strconv.FormatUint(policy.Revision, 10)
	mode := "Ask when a folder is not already allowed"
	if policy.Full {
		mode = "Full filesystem access enabled"
	}
	screen := workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "permissions", Title: "Permissions", Subtitle: "Manage live filesystem access and other app capabilities.", Notice: notice, Blocks: []uisnapshot.Block{{Title: "Filesystem", Lines: []string{mode, "Allow once lasts for one task and its delegates. Always saves the requested folder access. Full access allows live reads, creation, changes and deletion across accessible paths; OS permissions still apply.", "One-task grants remain on their task reviews; Revoke all also invalidates those grants. Foreground access is separate from read-only grants for exact scheduled task definitions. Scheduled jobs do not inherit full access or ordinary saved folders. Permission changes invalidate active filesystem access; completed changes are not undone."}}}}}
	mcpPolicy, err := mcpStore.Get()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	mcpLines := []string{"MCP calls ask for permission unless you explicitly choose Always allow this MCP. Grants are bound to the exact project, server and trusted bundle, and apply to foreground calls only."}
	for _, grant := range mcpPolicy.Grants {
		mcpLines = append(mcpLines, grant.Server+" · "+grant.Repository)
		screen.Actions = append(screen.Actions, workapp.ControlAction{Label: "Ask before calls to " + grant.Server, Action: "mcp-revoke", Args: []string{strconv.FormatUint(mcpPolicy.Revision, 10), grant.Repository, grant.Hash, grant.Server}})
	}
	screen.Panel.Blocks = append(screen.Panel.Blocks, uisnapshot.Block{Title: "MCP servers", Lines: mcpLines})
	schedulePolicy, err := scheduling.Get()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	scheduleMode := "Ask before each schedule change"
	if schedulePolicy.Always {
		scheduleMode = "Always allow scheduling"
	}
	screen.Panel.Blocks = append([]uisnapshot.Block{{Title: "Scheduled tasks", Lines: []string{scheduleMode, "Allow once approves only the exact proposed change. Always allow lets HCB create, edit, pause, resume and cancel saved tasks until revoked. This does not grant file, account, computer or external-action permissions. Returning to Ask affects future management, not tasks already scheduled."}}}, screen.Panel.Blocks...)
	if schedulePolicy.Always {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Label: "Ask before schedule changes", Action: "schedule-ask", Args: []string{strconv.FormatUint(schedulePolicy.Revision, 10)}})
	} else {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Label: "Always allow scheduling", Action: "schedule-always", Args: []string{strconv.FormatUint(schedulePolicy.Revision, 10)}, Review: true, Description: "Allow HCB to create, edit, pause, resume and cancel scheduled tasks in this local profile without another schedule-management prompt. Revoke this in Permissions at any time. This does not approve external actions or expand a task’s execution permissions."})
	}
	screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "N", Label: "Add folder permission", Action: "preview", Args: []string{revision}, Preview: true, Fields: []workapp.ControlField{{Label: "Folder", Kind: "text", Help: "Absolute folder path or ~/path"}, {Label: "Access", Kind: "select", Value: "read", Options: []uisnapshot.Option{{Value: "read", Label: "Read only"}, {Value: "write", Label: "Read, create, update and delete"}}}}})
	jobStore, err := jobs.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	definitions, err := jobStore.List()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	options := []uisnapshot.Option{}
	for _, job := range definitions {
		options = append(options, uisnapshot.Option{Value: job.ID, Label: job.Name})
	}
	if len(options) > 0 {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "S", Label: "Allow a scheduled task to read a folder", Action: "preview-scheduled", Args: []string{revision}, Preview: true, Fields: []workapp.ControlField{{Label: "Folder", Kind: "text", Help: "Read-only access for the selected task; foreground grants remain separate."}, {Label: "Scheduled task", Kind: "select", Value: options[0].Value, Options: options}}})
	}
	if policy.Full {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "F", Label: "Turn full filesystem access off", Action: "full-off", Args: []string{revision}})
	} else {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "F", Label: "Enable full filesystem access", Action: "full-on", Args: []string{revision}, Review: true, Description: "Allow foreground HCB tasks and delegated workers to read, create, modify and delete files across the accessible filesystem without folder permission prompts. This persists until disabled. File contents may be sent to the selected model. HCB's own permission, credential and execution records remain protected; operating-system restrictions still apply. This does not enable shell, desktop, browser or connected-account permissions."})
	}
	for i, grant := range policy.Grants {
		access := "Read only"
		if grant.Access == "write" {
			access = "Read, create, update and delete"
		}
		if grant.JobID != "" {
			access = "Scheduled reads only · " + grant.JobID + " · exact reviewed task definition"
		}
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: fmt.Sprint(i + 1), Label: "Revoke " + grant.Root, Detail: access, Action: "revoke", Args: []string{revision, grant.ID}})
	}
	screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "X", Label: "Revoke all filesystem access", Action: "revoke-all", Args: []string{revision}}, workapp.ControlAction{Key: "C", Label: "Computer permissions", Command: "/computer"}, workapp.ControlAction{Key: "B", Label: "Browser permissions", Command: "/browser"}, workapp.ControlAction{Key: "A", Label: "Connected account permissions", Command: "/connections"}, workapp.ControlAction{Key: "R", Label: "Refresh", Action: "status"})
	return screen, nil
}
