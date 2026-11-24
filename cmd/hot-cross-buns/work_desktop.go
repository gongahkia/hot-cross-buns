package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/desktop"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

func computerControl(ctx context.Context, stateDir, operation string, args []string) (workapp.ControlScreen, error) {
	return computerControlWithRuntime(ctx, stateDir, operation, args, desktop.DefaultRuntime())
}
func computerControlWithRuntime(ctx context.Context, stateDir, operation string, args []string, runtime desktop.Runtime) (workapp.ControlScreen, error) {
	release, err := state.Guard(stateDir, false)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	defer release()
	store, err := desktop.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	id, notice := "", ""
	if len(args) > 0 {
		id = args[0]
	}
	var grant *workapp.DesktopGrant
	switch operation {
	case "status", "select":
		if len(args) > 1 {
			return workapp.ControlScreen{}, errors.New("select one computer session")
		}
	case "apps":
		if len(args) != 0 {
			return workapp.ControlScreen{}, errors.New("refresh computer access before choosing an app")
		}
		return computerAppScreen(ctx, runtime)
	case "start":
		if len(args) != 1 {
			return workapp.ControlScreen{}, errors.New("choose one running application")
		}
		apps, err := desktop.AvailableApplications(ctx, runtime)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		var selected desktop.Application
		for _, app := range apps {
			if app.BundleID == args[0] {
				selected = app
			}
		}
		if selected.BundleID == "" {
			return workapp.ControlScreen{}, errors.New("this app closed or is no longer eligible; choose it again")
		}
		trusted, err := runtime.AccessibilityTrusted()
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		if !trusted {
			return workapp.ControlScreen{}, errors.New("allow Accessibility for the Hot Cross Buns runtime in macOS Privacy & Security, then refresh")
		}
		session, err := store.Start(desktop.StartOptions{Apps: []desktop.Application{selected}, Paused: true})
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		id = session.ID
		notice = "App selected. Access starts paused; resume when the window is ready to share."
	case "clear-grant":
		if len(args) > 1 {
			return workapp.ControlScreen{}, errors.New("invalid computer selection")
		}
		grant = &workapp.DesktopGrant{}
	case "pause", "resume", "stop", "grant":
		if len(args) != 2 {
			return workapp.ControlScreen{}, errors.New("refresh computer access before reviewing this action")
		}
		session, err := store.Get(id)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		if desktop.PolicyDigest(session) != args[1] {
			return workapp.ControlScreen{}, errors.New("computer access changed; refresh and review again")
		}
		if session.State != desktop.StateRunning {
			return workapp.ControlScreen{}, desktop.ErrStopped
		}
		switch operation {
		case "pause":
			_, err = store.SetPaused(id, true)
			notice = "Computer access paused. Earlier task grants are invalid; take over privately."
		case "resume", "grant":
			trusted, accessErr := runtime.AccessibilityTrusted()
			if accessErr != nil {
				return workapp.ControlScreen{}, accessErr
			}
			if !trusted {
				return workapp.ControlScreen{}, errors.New("macOS Accessibility access is unavailable; enable it and refresh")
			}
			if _, ok := runtime.(desktop.AccessibilityRuntime); !ok {
				return workapp.ControlScreen{}, errors.New("native accessibility driver is unavailable")
			}
			if operation == "resume" {
				_, err = store.SetPaused(id, false)
				notice = "Access enabled. Review a next-task grant to share the app with this chat."
			} else {
				if session.Paused {
					return workapp.ControlScreen{}, desktop.ErrPaused
				}
				grant = &workapp.DesktopGrant{SessionID: id, Policy: args[1]}
				notice = "Computer access selected for the next task in this chat. Each app activation and control action still needs approval."
			}
		case "stop":
			_, err = store.Stop(id)
			notice = "Computer access revoked. Earlier actions are not undone."
		}
		if err != nil {
			return workapp.ControlScreen{}, err
		}
	default:
		return workapp.ControlScreen{}, errors.New("unknown computer access operation")
	}
	screen, err := computerControlScreen(ctx, store, runtime, id)
	if err != nil {
		return screen, err
	}
	screen.Panel.Notice = notice
	screen.DesktopGrant = grant
	return screen, nil
}
func computerAppScreen(ctx context.Context, runtime desktop.Runtime) (workapp.ControlScreen, error) {
	screen := workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "computer", Title: "Choose an app", Subtitle: "Only the app you choose can be read or controlled. Open the app first if it is missing."}}
	apps, err := desktop.AvailableApplications(ctx, runtime)
	if err != nil {
		return screen, err
	}
	for i, app := range apps {
		screen.Actions = append(screen.Actions, workapp.ControlAction{Key: fmt.Sprint(i + 1), Label: app.Name, Detail: app.BundleID, Action: "start", Args: []string{app.BundleID}, Review: true, Description: "Select " + app.Name + " (" + app.BundleID + ") for computer access. Access starts paused. When granted for a task, visible accessibility text from this app's focused window can be sent to the selected model. Every activation, button action and text replacement requires its own approval. Sensitive fields and modal dialogs require private takeover. No screenshots are enabled by this selection."})
	}
	if len(apps) == 0 {
		screen.Panel.Blocks = []uisnapshot.Block{{Title: "No eligible apps", Lines: []string{"Open the app you want to use, then refresh this list."}}}
	}
	screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "R", Label: "Refresh apps", Action: "apps"}, workapp.ControlAction{Key: "B", Label: "Back", Action: "status"})
	return screen, nil
}
func computerControlScreen(_ context.Context, store *desktop.Store, runtime desktop.Runtime, id string) (workapp.ControlScreen, error) {
	screen := workapp.ControlScreen{Location: id, Panel: uisnapshot.Panel{Kind: "computer", Title: "Computer access", Subtitle: "Share an app for one task. Pause before signing in or taking over."}}
	trusted, permissionErr := runtime.AccessibilityTrusted()
	_, driver := runtime.(desktop.AccessibilityRuntime)
	available := trusted && permissionErr == nil && driver
	if !available {
		line := "In macOS System Settings → Privacy & Security → Accessibility, allow the Hot Cross Buns runtime or the terminal that launches it, then refresh."
		if !driver {
			line = "Computer access requires macOS and a build with the native accessibility driver."
		}
		screen.Panel.Blocks = append(screen.Panel.Blocks, uisnapshot.Block{Title: "Setup required", Lines: []string{line}})
	}
	if id == "" {
		if available {
			screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "N", Label: "Choose an app", Action: "apps"})
		}
		sessions, err := store.List()
		if err != nil {
			return screen, err
		}
		for i, session := range sessions {
			if session.State != desktop.StateRunning {
				continue
			}
			access := "Access enabled"
			if session.Paused {
				access = "Paused"
			}
			screen.Actions = append(screen.Actions, workapp.ControlAction{Key: fmt.Sprint(i + 1), Label: computerAppNames(session), Detail: access, Action: "select", Args: []string{session.ID}})
		}
	} else {
		session, err := store.Get(id)
		if err != nil {
			return screen, err
		}
		policy := desktop.PolicyDigest(session)
		args := []string{id, policy}
		access := string(session.State)
		if session.Paused && session.State == desktop.StateRunning {
			access = "Paused for private takeover"
		}
		screen.Panel.Blocks = append(screen.Panel.Blocks, uisnapshot.Block{Title: computerAppNames(session), Lines: []string{"Access: " + access, "Only the focused window in an approved app is readable. Each action returns to its reviewed window and checks for changed controls.", "Accessibility text may be sent to your selected model. This path sends no screenshots. Use connected services or browser access when an app does not expose usable controls."}})
		if session.State == desktop.StateRunning {
			if !session.Paused {
				screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "P", Label: "Pause for private takeover", Action: "pause", Args: args})
			}
			if available {
				if session.Paused {
					screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "E", Label: "Resume access", Action: "resume", Args: args, Review: true, Description: "Enable accessibility reads for " + computerAppNames(session) + ". Any earlier task grant remains invalid. Review a new next-task grant to let the model use the app."})
				} else {
					screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "G", Label: "Use for next task", Action: "grant", Args: args, Review: true, Description: "Grant " + computerAppNames(session) + " to the next submitted or queued task in this chat only. Visible accessibility text from approved windows can be sent to the selected model. App activations and control actions each require fresh approval. Secure fields, modal/file dialogs, Terminal, Finder, Keychain and system settings are unavailable. No screenshots or coordinate/keyboard control are granted."})
				}
			}
			screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "S", Label: "Revoke access", Action: "stop", Args: args})
		}
	}
	screen.Actions = append(screen.Actions, workapp.ControlAction{Key: "C", Label: "Clear next-task computer", Action: "clear-grant", Args: []string{id}}, workapp.ControlAction{Key: "R", Label: "Refresh", Action: "status", Args: []string{id}}, workapp.ControlAction{Key: "B", Label: "All computer sessions", Action: "status"})
	return screen, nil
}
func computerAppNames(session desktop.Session) string {
	names := []string{}
	for _, app := range session.Apps {
		name := app.Name
		if name == "" {
			name = app.BundleID
		} else {
			name += " (" + app.BundleID + ")"
		}
		names = append(names, name)
	}
	return strings.Join(names, ", ")
}
