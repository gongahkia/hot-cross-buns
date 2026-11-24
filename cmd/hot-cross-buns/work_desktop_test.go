package main

import (
	"context"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/desktop"
)

type computerControlsRuntime struct {
	desktop.Runtime
	trusted bool
}

func (r computerControlsRuntime) AccessibilityTrusted() (bool, error) { return r.trusted, nil }
func (computerControlsRuntime) Applications(context.Context) ([]desktop.Application, error) {
	return []desktop.Application{{BundleID: "dev.hcb.fixture", Name: "Fixture"}, {BundleID: "com.apple.Terminal", Name: "Terminal"}}, nil
}
func (computerControlsRuntime) ReadAccessibility(context.Context, desktop.Window) (desktop.AccessibilityTree, error) {
	return desktop.AccessibilityTree{}, nil
}
func (computerControlsRuntime) PerformAccessibility(context.Context, desktop.Window, desktop.AccessibilityTree, desktop.AccessibilityElement, string, string) error {
	return nil
}
func TestComputerControlsReviewedAppTakeoverGrantAndRevocation(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	runtime := computerControlsRuntime{trusted: true}
	apps, err := computerControlWithRuntime(ctx, root, "apps", nil, runtime)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps.Actions) != 3 || apps.Actions[0].Args[0] != "dev.hcb.fixture" || !apps.Actions[0].Review {
		t.Fatal("forbidden app exposed", apps.Actions)
	}
	screen, err := computerControlWithRuntime(ctx, root, "start", apps.Actions[0].Args, runtime)
	if err != nil {
		t.Fatal(err)
	}
	store, _ := desktop.Open(root)
	session, err := store.Get(screen.Location)
	if err != nil || !session.Paused || session.RetainProviderState {
		t.Fatal(session, err)
	}
	for _, a := range screen.Actions {
		if a.Action == "grant" {
			t.Fatal("paused app granted")
		}
	}
	resume := browserAction(t, screen, "resume")
	if !resume.Review {
		t.Fatal("resume lacked review")
	}
	screen, err = computerControlWithRuntime(ctx, root, "resume", resume.Args, runtime)
	if err != nil {
		t.Fatal(err)
	}
	grant := browserAction(t, screen, "grant")
	if !grant.Review || !strings.Contains(grant.Description, "dev.hcb.fixture") {
		t.Fatal("grant omitted app scope")
	}
	screen, err = computerControlWithRuntime(ctx, root, "grant", grant.Args, runtime)
	if err != nil || screen.DesktopGrant == nil || screen.DesktopGrant.Policy != grant.Args[1] {
		t.Fatal(screen.DesktopGrant, err)
	}
	pause := browserAction(t, screen, "pause")
	screen, err = computerControlWithRuntime(ctx, root, "pause", pause.Args, runtime)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = computerControlWithRuntime(ctx, root, "grant", grant.Args, runtime); err == nil {
		t.Fatal("old grant revived")
	}
	// Revocation remains available after macOS permission is removed.
	stop := browserAction(t, screen, "stop")
	if _, err = computerControlWithRuntime(ctx, root, "stop", stop.Args, computerControlsRuntime{}); err != nil {
		t.Fatal(err)
	}
	session, _ = store.Get(session.ID)
	if session.State != desktop.StateStopped {
		t.Fatal("not revoked")
	}
}
func TestComputerControlsCannotGrantWithoutPermission(t *testing.T) {
	root := t.TempDir()
	store, _ := desktop.Open(root)
	session, _ := store.Start(desktop.StartOptions{Apps: []desktop.Application{{BundleID: "dev.hcb.fixture"}}})
	screen, err := computerControlWithRuntime(context.Background(), root, "status", []string{session.ID}, computerControlsRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range screen.Actions {
		if a.Action == "grant" || a.Action == "resume" {
			t.Fatal("permission bypass")
		}
	}
	if _, err = computerControlWithRuntime(context.Background(), root, "grant", []string{session.ID, desktop.PolicyDigest(session)}, computerControlsRuntime{}); err == nil {
		t.Fatal("grant without Accessibility")
	}
	if _, err = computerControlWithRuntime(context.Background(), root, "start", []string{"com.apple.Terminal"}, computerControlsRuntime{trusted: true}); err == nil {
		t.Fatal("forbidden app accepted")
	}
}
