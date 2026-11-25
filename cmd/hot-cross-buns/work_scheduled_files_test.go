package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
)

func TestScheduledReadReviewBindsJobDefinitionAndEnforcesPauseAndRevocation(t *testing.T) {
	ctx := context.Background()
	state, folder := t.TempDir(), t.TempDir()
	jobsStore, _ := jobs.Open(state)
	job, err := jobsStore.Save(jobs.Definition{Name: "Fixture notes", Enabled: true, Schedule: "0 9 * * *", Timezone: "Asia/Singapore", SourcePath: t.TempDir(), Objective: "Read approved notes", Mode: action.Inspect, Contract: artifact.InspectionContract()})
	if err != nil {
		t.Fatal(err)
	}
	screen, err := permissionControl(ctx, state, "status", nil)
	if err != nil {
		t.Fatal(err)
	}
	add := browserAction(t, screen, "preview-scheduled")
	screen, err = permissionControl(ctx, state, "preview-scheduled", append(add.Args, folder, job.ID))
	if err != nil {
		t.Fatal(err)
	}
	save := browserAction(t, screen, "save-scheduled")
	policyStore, _ := fileaccess.Open(state)
	before, _ := policyStore.Get()
	if len(before.Grants) != 0 {
		t.Fatal("preview granted access")
	}
	_, err = permissionControl(ctx, state, "save-scheduled", save.Args)
	if err != nil {
		t.Fatal(err)
	}
	policy, _ := policyStore.Get()
	canonical, _ := filepath.EvalSymlinks(folder)
	if len(policy.Grants) != 1 || policy.Grants[0].Root != canonical || policy.Grants[0].JobID != job.ID {
		t.Fatal(policy)
	}
	request := jobWorkRequest(job)
	check := scheduledFilesCheck(state, request)
	if err = check(); err != nil {
		t.Fatal(err)
	}
	_, err = jobsStore.SetEnabled(job.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if check() == nil {
		t.Fatal("paused job retained access")
	}
	_, err = jobsStore.SetEnabled(job.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = check(); err != nil {
		t.Fatal("unchanged resumed job lost its reviewed scope", err)
	}
	job.Objective = "A different task"
	if _, err = jobsStore.Save(job); err != nil {
		t.Fatal(err)
	}
	if check() == nil {
		t.Fatal("changed job retained access")
	}
}
