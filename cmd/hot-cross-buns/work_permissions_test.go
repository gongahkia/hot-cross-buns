package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
)

func TestPermissionSettingsPreviewSaveNarrowAndRevoke(t *testing.T) {
	ctx := context.Background()
	state := t.TempDir()
	folder := t.TempDir()
	store, _ := fileaccess.Open(state)
	screen, err := permissionControl(ctx, state, "status", nil)
	if err != nil {
		t.Fatal(err)
	}
	full := browserAction(t, screen, "full-on")
	if !full.Review {
		t.Fatal("full access without review")
	}
	add := browserAction(t, screen, "preview")
	if !add.Preview {
		t.Fatal("folder scope without computed review")
	}
	screen, err = permissionControl(ctx, state, "preview", append(add.Args, folder, "write"))
	if err != nil {
		t.Fatal(err)
	}
	policy, _ := store.Get()
	if policy.Full || len(policy.Grants) != 0 {
		t.Fatal("preview granted access")
	}
	save := browserAction(t, screen, "save")
	screen, err = permissionControl(ctx, state, "save", save.Args)
	if err != nil {
		t.Fatal(err)
	}
	policy, _ = store.Get()
	canonical, _ := filepath.EvalSymlinks(folder)
	if len(policy.Grants) != 1 || policy.Grants[0].Root != canonical || policy.Grants[0].Access != "write" {
		t.Fatal(policy)
	}
	if _, err = permissionControl(ctx, state, "full-on", full.Args); err == nil {
		t.Fatal("stale broadening accepted")
	}
	full = browserAction(t, screen, "full-on")
	screen, err = permissionControl(ctx, state, "full-on", full.Args)
	if err != nil {
		t.Fatal(err)
	}
	narrow := browserAction(t, screen, "full-off")
	screen, err = permissionControl(ctx, state, "full-off", narrow.Args)
	if err != nil {
		t.Fatal(err)
	}
	all := browserAction(t, screen, "revoke-all")
	if _, err = permissionControl(ctx, state, "revoke-all", all.Args); err != nil {
		t.Fatal(err)
	}
	policy, _ = store.Get()
	if policy.Full || len(policy.Grants) != 0 {
		t.Fatal(policy)
	}
}
