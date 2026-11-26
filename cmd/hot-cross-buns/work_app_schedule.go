package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workhome"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

type scheduleChange struct {
	Action         string  `json:"action"`
	ID             string  `json:"id,omitempty"`
	ExpectedDigest string  `json:"expected_digest,omitempty"`
	Title          *string `json:"title,omitempty"`
	Prompt         *string `json:"prompt,omitempty"`
	Cron           *string `json:"cron,omitempty"`
	RunAt          *string `json:"run_at,omitempty"`
	Timezone       *string `json:"timezone,omitempty"`
	EndsAt         *string `json:"ends_at,omitempty"`
	Missed         *string `json:"missed,omitempty"`
}
type scheduleView struct {
	ID              string    `json:"id"`
	Digest          string    `json:"expected_digest"`
	Title           string    `json:"title"`
	Prompt          string    `json:"prompt"`
	PromptTruncated bool      `json:"prompt_truncated,omitempty"`
	Kind            string    `json:"kind"`
	Timing          string    `json:"timing"`
	Timezone        string    `json:"timezone"`
	State           string    `json:"state"`
	Enabled         bool      `json:"enabled"`
	NextDue         time.Time `json:"next_due,omitzero"`
	Issue           string    `json:"issue,omitempty"`
	Origin          string    `json:"origin_conversation_id,omitempty"`
	Source          string    `json:"source"`
}

func projectSchedule(check workhome.Check, full bool) scheduleView {
	d := check.Definition
	digest, _ := d.PolicyDigest()
	prompt := d.Objective
	truncated := !full && len(prompt) > 240
	if truncated {
		prompt = boundedIntroduction(prompt, 240)
	}
	return scheduleView{ID: d.ID, Digest: digest, Title: d.Name, Prompt: prompt, PromptTruncated: truncated, Kind: d.ScheduleKind(), Timing: d.Timing(), Timezone: d.Timezone, State: check.State, Enabled: d.Enabled, NextDue: check.NextDue, Issue: check.Issue, Origin: d.OriginConversationID, Source: d.SourcePath}
}
func (c hotCrossBunsAppController) inspectSchedules(query workrun.AppQuery) (any, error) {
	if err := c.followupConversation(query.ConversationID); err != nil {
		return nil, err
	}
	if query.Page < 0 || query.Page > 1000 || len(query.Query) > 256 {
		return nil, errors.New("use a schedule search up to 256 bytes and a page between 1 and 1000")
	}
	checks, online, err := readFollowupChecks(c.stateDir)
	if err != nil {
		return nil, err
	}
	policyStore, err := scheduleaccess.Open(c.stateDir)
	if err != nil {
		return nil, err
	}
	policy, err := policyStore.Get()
	if err != nil {
		return nil, err
	}
	page := max(1, query.Page)
	items := []scheduleView{}
	matched := 0
	for _, check := range checks {
		if query.ID != "" && check.ID != query.ID {
			continue
		}
		if query.Query != "" && !strings.Contains(strings.ToLower(check.Definition.Name+" "+check.ID), strings.ToLower(query.Query)) {
			continue
		}
		matched++
		if query.ID == "" && (matched <= (page-1)*50 || len(items) == 50) {
			continue
		}
		items = append(items, projectSchedule(check, query.ID != ""))
	}
	if query.ID != "" && len(items) == 0 {
		return nil, errors.New("that schedule no longer exists; list schedules again")
	}
	mode := "ask"
	if policy.Always {
		mode = "always"
	}
	return map[string]any{"tasks": items, "total": len(checks), "matched": matched, "page": page, "pages": max(1, (matched+49)/50), "supervisor_running": online, "management_permission": mode, "note": "All saved schedules in this local profile. Inspect an exact id for its complete prompt and expected_digest before editing or canceling. A due time does not mean an offline task ran. Scheduling permission grants no file, account or external-action access."}, nil
}

func (c hotCrossBunsAppController) withSchedulingPermission(m workrun.AppMutation, review scheduleaccess.Review) (workrun.AppMutation, error) {
	store, err := scheduleaccess.Open(c.stateDir)
	if err != nil {
		return workrun.AppMutation{}, err
	}
	policy, err := store.Get()
	if err != nil {
		return workrun.AppMutation{}, err
	}
	apply := m.Apply
	m.Review = !policy.Always
	m.ScheduleReview = &review
	m.ApplySchedule = func(ctx context.Context, choice string) (any, error) {
		return store.Apply(ctx, policy.Revision, choice, func() (any, error) { return apply(ctx) })
	}
	return m, nil
}

func (c hotCrossBunsAppController) prepareSchedule(ctx context.Context, change workrun.AppChange) (workrun.AppMutation, error) {
	if err := ctx.Err(); err != nil {
		return workrun.AppMutation{}, err
	}
	if c.request == nil || !c.request.ForegroundApp {
		return workrun.AppMutation{}, errors.New("schedule management requires a foreground HCB conversation")
	}
	if err := c.followupConversation(change.ConversationID); err != nil {
		return workrun.AppMutation{}, err
	}
	var v scheduleChange
	if err := workrun.DecodeAppArguments(change.Value, &v); err != nil {
		return workrun.AppMutation{}, err
	}
	if v.Action != "create" && v.Action != "edit" && v.Action != "pause" && v.Action != "resume" && v.Action != "cancel" {
		return workrun.AppMutation{}, errors.New("schedule action must be create, edit, pause, resume or cancel")
	}
	store, err := jobs.Open(c.stateDir)
	if err != nil {
		return workrun.AppMutation{}, err
	}
	settings, err := c.settings.Load()
	if err != nil {
		return workrun.AppMutation{}, err
	}
	now := time.Now().UTC()
	var next jobs.Definition
	if v.Action == "create" {
		if v.ID != "" || v.ExpectedDigest != "" || v.Title == nil || v.Prompt == nil {
			return workrun.AppMutation{}, errors.New("new schedules require title, prompt and timing; do not supply an existing id")
		}
		identity := c.request.RunID
		if identity == "" {
			var random [16]byte
			if _, err := rand.Read(random[:]); err != nil {
				return workrun.AppMutation{}, err
			}
			identity = fmt.Sprintf("%x", random)
		}
		var canonical any
		if err := json.Unmarshal(change.Value, &canonical); err != nil {
			return workrun.AppMutation{}, err
		}
		payload, _ := json.Marshal(canonical)
		digest := sha256.Sum256([]byte(identity + "\n" + change.ConversationID + "\n" + string(payload)))
		next = jobs.Definition{Version: jobs.Version, ID: fmt.Sprintf("job-chat-%x", digest[:16]), Name: strings.TrimSpace(*v.Title), Objective: strings.TrimSpace(*v.Prompt), Enabled: true, SourcePath: filepath.Clean(c.request.SourcePath), OriginConversationID: change.ConversationID, Timezone: settings.JobDefaults.Timezone, Missed: "run_once", Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 24, Provider: settings.Defaults.Provider, Model: settings.Defaults.Model, RefreshSnapshot: true, CreatedAt: now, UpdatedAt: now}
		if v.Cron == nil && v.RunAt == nil {
			return workrun.AppMutation{}, errors.New("choose a future run_at for one-time work or cron for recurring work")
		}
	} else {
		if v.ID == "" || v.ExpectedDigest == "" {
			return workrun.AppMutation{}, errors.New("inspect the exact schedule id and expected_digest first")
		}
		next, err = store.Load(v.ID)
		if err != nil {
			return workrun.AppMutation{}, err
		}
		digest, _ := next.PolicyDigest()
		if digest != v.ExpectedDigest {
			return workrun.AppMutation{}, errors.New("this schedule changed; inspect its current agreement")
		}
	}
	changes := v.Title != nil || v.Prompt != nil || v.Cron != nil || v.RunAt != nil || v.Timezone != nil || v.EndsAt != nil || v.Missed != nil
	if v.Action == "edit" && !changes {
		return workrun.AppMutation{}, errors.New("specify the fields to edit")
	}
	if v.Action != "create" && v.Action != "edit" && changes {
		return workrun.AppMutation{}, errors.New("pause, resume and cancel accept only id and expected_digest")
	}
	if v.Title != nil {
		next.Name = strings.TrimSpace(*v.Title)
	}
	if v.Prompt != nil {
		next.Objective = strings.TrimSpace(*v.Prompt)
	}
	if v.Cron != nil && v.RunAt != nil {
		return workrun.AppMutation{}, errors.New("choose either run_at or cron, not both")
	}
	if v.Cron != nil {
		next.Schedule = strings.TrimSpace(*v.Cron)
		next.RunAt = time.Time{}
	}
	if v.RunAt != nil {
		next.RunAt, err = time.Parse(time.RFC3339, *v.RunAt)
		if err != nil {
			return workrun.AppMutation{}, errors.New("run_at must include a date, time and explicit timezone offset")
		}
		next.Schedule = ""
		if !next.RunAt.After(now.Truncate(time.Minute)) {
			return workrun.AppMutation{}, errors.New("choose a future minute for this one-time task")
		}
	}
	if v.Timezone != nil {
		next.Timezone = *v.Timezone
	}
	if v.Missed != nil {
		next.Missed = *v.Missed
	}
	if v.EndsAt != nil {
		next.EndsAt = time.Time{}
		if *v.EndsAt != "" {
			next.EndsAt, err = time.Parse(time.RFC3339, *v.EndsAt)
			if err != nil {
				return workrun.AppMutation{}, errors.New("ends_at must include an explicit timezone offset")
			}
		}
	}
	if v.Action == "pause" {
		next.Enabled = false
	}
	if v.Action == "resume" {
		next.Enabled = true
	}
	if next.Enabled && next.Expired(now) && v.Action != "cancel" {
		return workrun.AppMutation{}, errors.New("this task ended; choose a future end date before resuming")
	}
	if v.Action == "resume" && !next.RunAt.IsZero() && !next.RunAt.After(now) && !next.LastScheduledAt.Before(next.RunAt) {
		return workrun.AppMutation{}, errors.New("this one-time task already has an execution attempt; inspect its result or edit run_at to schedule another occurrence")
	}
	if len(next.Objective) > 8192 && v.Prompt != nil {
		return workrun.AppMutation{}, errors.New("keep a scheduled prompt within 8192 bytes")
	}
	if err := next.Validate(); err != nil {
		return workrun.AppMutation{}, err
	}
	lines := []string{"When: " + next.Timing(), "Prompt: " + next.Objective, "Workspace: " + next.SourcePath, "Missed runs: " + missedCheckLabel(next.Missed), fmt.Sprintf("Execution: %s; %d work steps. Existing task budgets, accounts and permissions stay in force.", next.Mode, next.MaxSteps)}
	if v.Action != "create" {
		lines = append([]string{"Task: " + next.ID, "Scope: this saved task only. Run history and the original chat are retained."}, lines...)
	}
	if v.Action == "pause" || v.Action == "cancel" {
		lines = append(lines, "Future runs stop. An already-started run may finish.")
	}
	apply := func(ctx context.Context) (any, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := c.followupConversation(change.ConversationID); err != nil {
			return nil, err
		}
		var saved jobs.Definition
		var err error
		switch v.Action {
		case "create":
			saved, err = store.CreateOnce(next)
		case "cancel":
			err = store.RemoveReviewed(next.ID, v.ExpectedDigest)
		default:
			saved, err = store.SaveReviewed(next, v.ExpectedDigest)
		}
		if err != nil {
			return nil, err
		}
		if v.Action == "cancel" {
			return map[string]any{"id": next.ID, "canceled": true, "note": "Future runs canceled. History and the original chat remain. A current run may finish."}, nil
		}
		checks, online, err := readFollowupChecks(c.stateDir)
		if err != nil {
			return map[string]any{"saved": true, "id": saved.ID, "availability": "unknown", "issue": err.Error()}, nil
		}
		for _, check := range checks {
			if check.ID == saved.ID {
				return map[string]any{"saved": true, "task": projectSchedule(check, true), "supervisor_running": online}, nil
			}
		}
		return map[string]any{"saved": true, "id": saved.ID, "note": "Saved; refresh Scheduled tasks for its current state."}, nil
	}
	return c.withSchedulingPermission(workrun.AppMutation{Summary: "Schedule " + v.Action + ": " + next.Name, Apply: apply}, scheduleaccess.Review{Action: v.Action, Title: next.Name, Lines: lines})
}
