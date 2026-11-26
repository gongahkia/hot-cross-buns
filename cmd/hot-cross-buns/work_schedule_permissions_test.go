package main

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"strconv"
	"testing"
)

func TestSchedulingSettingsUseSeparateRevisionAndCanRevokeAlways(t *testing.T) {
	c := followupControllerForTest(t)
	ctx := context.Background()
	store, _ := scheduleaccess.Open(c.stateDir)
	policy, _ := store.Get()
	screen, err := permissionControl(ctx, c.stateDir, "status", nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range screen.Actions {
		if a.Action == "schedule-always" {
			found = a.Review
		}
	}
	if !found {
		t.Fatal("always setting lacks a review")
	}
	if _, err := permissionControl(ctx, c.stateDir, "schedule-always", []string{strconv.FormatUint(policy.Revision, 10)}); err != nil {
		t.Fatal(err)
	}
	allowed, _ := store.Get()
	if !allowed.Always {
		t.Fatal("setting not saved")
	}
	if _, err := permissionControl(ctx, c.stateDir, "schedule-ask", []string{strconv.FormatUint(policy.Revision, 10)}); err == nil {
		t.Fatal("stale settings edit accepted")
	}
	if _, err := permissionControl(ctx, c.stateDir, "schedule-ask", []string{strconv.FormatUint(allowed.Revision, 10)}); err != nil {
		t.Fatal(err)
	}
	after, _ := store.Get()
	if after.Always {
		t.Fatal("grant not revoked")
	}
}
