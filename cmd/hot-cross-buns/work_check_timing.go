package main

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

// Timing edits copy the canonical definition, changing only the selected timing
// fields. In particular, they never rebuild legacy policies as goal-watch drafts.
func checkTimingControl(ctx context.Context, stateDir, action string, args []string) (workapp.ControlScreen, error) {
	if err := ctx.Err(); err != nil {
		return workapp.ControlScreen{}, err
	}
	if len(args) < 2 {
		return workapp.ControlScreen{}, errors.New("refresh Following and select the check to edit")
	}
	if action != "status" && action != "preview-timing" && action != "save-timing" {
		return workapp.ControlScreen{}, errors.New("invalid timing action")
	}
	if action == "status" && len(args) != 2 {
		return workapp.ControlScreen{}, errors.New("select one saved check")
	}
	store, err := jobs.Open(stateDir)
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	prior, err := store.Load(args[0])
	if err != nil {
		return workapp.ControlScreen{}, fmt.Errorf("this check is unavailable; refresh Following: %w", err)
	}
	digest, err := prior.PolicyDigest()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	if digest != args[1] {
		return workapp.ControlScreen{}, errors.New("this check changed; refresh Following and review its current agreement")
	}
	if prior.GoalWatch {
		return workapp.ControlScreen{}, errors.New("edit this project's polling agreement from Following")
	}
	if action == "status" {
		return checkTimingScreen(prior), nil
	}
	next, err := changedCheckTiming(prior, args[2:], time.Now())
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	if err := ctx.Err(); err != nil {
		return workapp.ControlScreen{}, err
	}
	if action == "save-timing" {
		release, err := state.Guard(stateDir, false)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		defer release()
		saved, err := store.SaveReviewed(next, digest)
		if err != nil {
			return workapp.ControlScreen{}, err
		}
		screen := checkTimingScreen(saved)
		screen.RefreshChecks = true
		screen.Panel.Notice = "Timing saved. Existing work may finish. The check's enabled state, accounts, sources and permissions are retained. No check or service was started."
		screen.Panel.NoticeTone = "success"
		return screen, nil
	}
	proposed, err := next.PolicyDigest()
	if err != nil {
		return workapp.ControlScreen{}, err
	}
	lines := []string{"Check: " + prior.Name + " · " + prior.ID,
		"Previous schedule: " + prior.Timing(),
		"Proposed schedule: " + next.Timing(),
		"Missed checks: " + missedCheckLabel(next.Missed),
		"Ends: " + checkEndLabel(next.EndsAt),
		"Task name: " + next.Name, "Scheduled prompt: " + next.Objective,
		"Enabled state retained: " + strconv.FormatBool(next.Enabled),
		"An existing check may finish. Future checks use the saved schedule while this computer is awake, the local service is running, and its sources are accessible.",
		"Saving does not run a check, start the service, resume a goal, or grant permissions. Other checks stay unchanged."}
	lines = append(lines, checkTimingNext(next, time.Now())...)
	return workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "confirmation", Title: "Review check timing", PresentationID: "check-timing-review:" + prior.ID,
		ActionIdentity: digest + ":" + proposed, Blocks: []uisnapshot.Block{{Title: "Exact timing change", Lines: lines}, {Title: "Retained agreement", Lines: checkTimingAgreement(prior), Collapsible: true}}},
		Actions: []workapp.ControlAction{{Key: "Enter", Label: "Save timing", Action: "save-timing", Args: append([]string(nil), args...)}}}, nil
}

func changedCheckTiming(prior jobs.Definition, values []string, now time.Time) (jobs.Definition, error) {
	next := prior
	if len(values) == 0 {
		return next, errors.New("choose the timing change")
	}
	switch values[0] {
	case "daily", "weekdays":
		next.RunAt = time.Time{}
		if len(values) != 3 {
			return next, errors.New("provide a local time and timezone")
		}
		clock, err := time.Parse("15:04", values[1])
		if err != nil || clock.Format("15:04") != values[1] {
			return next, errors.New("use a 24-hour time such as 09:30")
		}
		days := "*"
		if values[0] == "weekdays" {
			days = "1-5"
		}
		next.Schedule, next.Timezone = fmt.Sprintf("%d %d * * %s", clock.Minute(), clock.Hour(), days), values[2]
	case "hourly":
		next.RunAt = time.Time{}
		if len(values) != 3 {
			return next, errors.New("provide the minute of the hour and timezone")
		}
		minute, err := strconv.Atoi(values[1])
		if err != nil || minute < 0 || minute > 59 {
			return next, errors.New("choose a minute from 0 to 59")
		}
		next.Schedule, next.Timezone = fmt.Sprintf("%d * * * *", minute), values[2]
	case "custom":
		next.RunAt = time.Time{}
		if len(values) != 3 {
			return next, errors.New("provide a five-field schedule and timezone")
		}
		next.Schedule, next.Timezone = strings.TrimSpace(values[1]), values[2]
	case "once":
		if len(values) != 4 {
			return next, errors.New("choose a date, local time and timezone")
		}
		location, err := time.LoadLocation(values[3])
		if err != nil {
			return next, errors.New("choose a valid timezone")
		}
		stamp := values[1] + " " + values[2]
		at, err := time.ParseInLocation("2006-01-02 15:04", stamp, location)
		if err != nil || at.Format("2006-01-02 15:04") != stamp || !at.After(now) {
			return next, errors.New("choose a future local time that exists in this timezone")
		}
		if at.Add(-time.Hour).In(location).Format("2006-01-02 15:04") == stamp || at.Add(time.Hour).In(location).Format("2006-01-02 15:04") == stamp {
			return next, errors.New("this local time occurs twice when clocks change; choose another time or ask for an exact time with its UTC offset")
		}
		next.RunAt, next.Schedule, next.Timezone = at.UTC(), "", values[3]
	case "weekly":
		if len(values) != 4 {
			return next, errors.New("choose a weekday, local time and timezone")
		}
		day, err := strconv.Atoi(values[1])
		if err != nil || day < 0 || day > 6 {
			return next, errors.New("choose a weekday")
		}
		clock, err := time.Parse("15:04", values[2])
		if err != nil {
			return next, errors.New("choose a local time")
		}
		next.RunAt = time.Time{}
		next.Schedule = fmt.Sprintf("%d %d * * %d", clock.Minute(), clock.Hour(), day)
		next.Timezone = values[3]
	case "monthly":
		if len(values) != 4 {
			return next, errors.New("choose a day, local time and timezone")
		}
		day, err := strconv.Atoi(values[1])
		if err != nil || day < 1 || day > 31 {
			return next, errors.New("choose a day from 1 to 31")
		}
		clock, err := time.Parse("15:04", values[2])
		if err != nil {
			return next, errors.New("choose a local time")
		}
		next.RunAt = time.Time{}
		next.Schedule = fmt.Sprintf("%d %d %d * *", clock.Minute(), clock.Hour(), day)
		next.Timezone = values[3]
	case "prompt":
		if len(values) != 3 {
			return next, errors.New("enter a title and prompt")
		}
		next.Name, next.Objective = strings.TrimSpace(values[1]), strings.TrimSpace(values[2])
	case "missed":
		if len(values) != 2 || values[1] != "skip" && values[1] != "run_once" {
			return next, errors.New("choose skip or one catch-up check")
		}
		next.Missed = values[1]
	case "start":
		if len(values) != 2 {
			return next, errors.New("provide a start time, or leave it blank")
		}
		next.StartsAt = time.Time{}
		if values[1] != "" {
			at, err := time.Parse(time.RFC3339, values[1])
			if err != nil {
				return next, errors.New("choose a start date with a time and timezone")
			}
			next.StartsAt = at
		}
	case "end":
		if len(values) != 2 {
			return next, errors.New("provide an end time, or leave it blank")
		}
		next.EndsAt = time.Time{}
		if values[1] != "" {
			end, err := time.Parse(time.RFC3339, values[1])
			if err != nil || !end.After(now) {
				return next, errors.New("choose a future end date with a time and timezone, or leave it blank")
			}
			next.EndsAt = end
		}
	default:
		return next, errors.New("choose a supported timing change")
	}
	if err := next.Validate(); err != nil {
		return next, err
	}
	schedule, err := jobs.Schedule(next)
	if err != nil {
		return next, err
	}
	if schedule.Next(now).IsZero() {
		return next, errors.New("this schedule has no next occurrence; choose a valid date pattern")
	}
	return next, nil
}

func checkTimingScreen(definition jobs.Definition) workapp.ControlScreen {
	digest, _ := definition.PolicyDigest()
	args := []string{definition.ID, digest}
	clock, minute := "09:00", "0"
	parts := strings.Fields(definition.Schedule)
	if len(parts) == 5 {
		m, em := strconv.Atoi(parts[0])
		h, eh := strconv.Atoi(parts[1])
		if em == nil {
			minute = strconv.Itoa(m)
		}
		if em == nil && eh == nil {
			clock = fmt.Sprintf("%02d:%02d", h, m)
		}
	}
	timeField := workapp.ControlField{Label: "Local time (24-hour)", Value: clock, Help: "For example 09:30. The timezone below determines the local day."}
	zoneField := workapp.ControlField{Label: "Timezone", Value: definition.Timezone, Help: "IANA name, for example Asia/Singapore or America/New_York. Local follows this computer's timezone."}
	action := func(label, kind string, fields ...workapp.ControlField) workapp.ControlAction {
		return workapp.ControlAction{Label: label, Action: "preview-timing", Args: append(append([]string(nil), args...), kind), Fields: fields, Preview: true,
			Description: "Review the computed schedule before saving. Accounts, source selection, model, budgets and permissions are retained."}
	}
	start := ""
	if !definition.StartsAt.IsZero() {
		start = definition.StartsAt.Format(time.RFC3339)
	}
	end := ""
	if !definition.EndsAt.IsZero() {
		end = definition.EndsAt.Format(time.RFC3339)
	}
	return workapp.ControlScreen{Panel: uisnapshot.Panel{Kind: "controls", Title: "Check timing", Subtitle: definition.Name, ActionIdentity: digest,
		PresentationID: "check-timing:" + definition.ID, Summary: []uisnapshot.Field{{Label: "Schedule", Value: definition.Timing()}, {Label: "Missed checks", Value: missedCheckLabel(definition.Missed)}},
		Blocks: []uisnapshot.Block{{Title: "Next scheduled times", Lines: checkTimingNext(definition, time.Now()), Collapsible: true}, {Title: "Retained agreement", Lines: checkTimingAgreement(definition), Collapsible: true}}},
		Actions: []workapp.ControlAction{
			action("Daily at a local time", "daily", timeField, zoneField),
			action("Weekdays at a local time", "weekdays", timeField, zoneField),
			action("Hourly at a chosen minute", "hourly", workapp.ControlField{Label: "Minute of the hour (0–59)", Value: minute, Kind: "number", Help: "For example 15 runs at 10:15, 11:15, and so on."}, zoneField),
			action("Once on a date", "once", workapp.ControlField{Label: "Date", Kind: "date", Value: time.Now().Add(24 * time.Hour).Format("2006-01-02")}, timeField, zoneField),
			action("Every week", "weekly", workapp.ControlField{Label: "Day", Kind: "select", Value: "1", Options: []uisnapshot.Option{{Value: "1", Label: "Monday"}, {Value: "2", Label: "Tuesday"}, {Value: "3", Label: "Wednesday"}, {Value: "4", Label: "Thursday"}, {Value: "5", Label: "Friday"}, {Value: "6", Label: "Saturday"}, {Value: "0", Label: "Sunday"}}}, timeField, zoneField),
			action("Every month", "monthly", workapp.ControlField{Label: "Day of month", Kind: "number", Value: "1", Help: "Days absent from a month are skipped."}, timeField, zoneField),
			action("Edit task prompt", "prompt", workapp.ControlField{Label: "Task name", Value: definition.Name}, workapp.ControlField{Label: "What should HCB do?", Value: definition.Objective, Help: "This prompt runs through HCB with this task's existing read/draft permissions."}),
			action("Missed-check behavior", "missed", workapp.ControlField{Label: "When this computer returns", Value: definition.Missed, Kind: "select", Options: []uisnapshot.Option{{Value: "skip", Label: "Skip work missed while offline"}, {Value: "run_once", Label: "Run one catch-up check after returning"}}}),
			action("Change or remove start date", "start", workapp.ControlField{Label: "Start date and time (blank for no start)", Value: start, Kind: "datetime", Help: "The first eligible run is at or after this time."}),
			action("Change or remove end date", "end", workapp.ControlField{Label: "End date and time (blank for no end)", Value: end, Kind: "datetime", Help: "Include a timezone, for example 2030-11-12T18:00:00+08:00. An existing check may finish."}),
			{Label: "All scheduled tasks", Command: "/followup"},
		}}
}

func missedCheckLabel(value string) string {
	if value == "run_once" {
		return "One catch-up check after returning"
	}
	return "Skip work missed while offline"
}
func checkEndLabel(value time.Time) string {
	if value.IsZero() {
		return "No end date; pause this check to stop future runs"
	}
	return value.Format(time.RFC3339)
}
func checkTimingNext(definition jobs.Definition, now time.Time) []string {
	if !definition.EndsAt.IsZero() && !definition.EndsAt.After(now) {
		return []string{"Ended. Review a new end date before resuming checks."}
	}
	schedule, err := jobs.Schedule(definition)
	if err != nil {
		return []string{"Next time unavailable: " + err.Error()}
	}
	location, _ := time.LoadLocation(definition.Timezone)
	lines := []string{"Scheduled occurrences; actual checks also require an active goal (if linked), available sources and the local service."}
	if due, ready, err := jobs.Due(definition, now); err == nil && ready {
		lines = append(lines, "One catch-up run is due for "+due.In(location).Format("Jan 2 at 3:04 PM MST")+". The recorded scheduled time will remain visible on its late result.")
	}
	if !definition.Enabled {
		lines = append(lines, "Paused. These are schedule occurrences only; resume separately to enable checks.")
	}
	occurrences := 0
	for i := 0; i < 3; i++ {
		next := schedule.Next(now)
		if next.IsZero() || !definition.EndsAt.IsZero() && !next.Before(definition.EndsAt) {
			break
		}
		lines = append(lines, next.In(location).Format("Mon 2 Jan 2006, 15:04 MST (Z07:00)"))
		occurrences++
		now = next
	}
	if occurrences == 0 {
		lines = append(lines, "No scheduled occurrence before the current end date.")
	}
	return lines
}
func checkTimingAgreement(definition jobs.Definition) []string {
	lines := []string{"Check: " + definition.ID, "Outcome: " + definition.Objective, "Workspace: " + definition.SourcePath,
		"Permission mode: " + string(definition.Mode), "Model: " + definition.Provider + "/" + definition.Model,
		fmt.Sprintf("Per attempt: %d model requests · %d tokens · %d seconds · %d steps", definition.Limits.ModelRequests, definition.Limits.Tokens, definition.Limits.WallSeconds, definition.MaxSteps),
		"Sources: " + strings.Join(definition.ConnectorIDs, ", "), "Notification conditions: " + definition.AlertWhen,
		"Source snapshots, account pins, artifact contracts, code/web policies, linked goal and destination conversation stay unchanged.",
		"Sending or publishing still requires separate foreground approval."}
	for _, id := range definition.ConnectorIDs {
		if account := definition.OAuthAccountPins[id]; account != "" {
			lines = append(lines, "Retained account pin: "+id+" · "+account)
		}
	}
	return lines
}
