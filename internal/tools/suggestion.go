package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/reconciliation"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

// SuggestChange can only queue a reviewed candidate. It has no direct write
// path to active knowledge or a goal plan.
type SuggestChange struct {
	Plans          *LocalPlans
	Notes          *knowledge.Store
	ExcludedIDs    []string
	Store          suggestion.Store
	GoalID         string
	WorkID         string
	ConversationID string
	SourcePath     string
}

func (SuggestChange) Definition() agent.ToolDefinition {
	definition := agent.ToolDefinition{Name: "suggest_change", Description: `For an existing step update use this exact nesting: {"kind":"plan","goal_id":"<inspected goal>","plan_change":{"kind":"update_step","expected_revision":1,"step_id":"<existing step>","dependency_action":"replace","depends_on":["<prerequisite step>"]}}. Put scheduling/status fields in the same plan_change. Use preserve only when the user did not ask to change dependencies, or clear for explicit removal. When correcting a rejected call, retain every requested change, especially depends_on; correct only the reported invalid fields. ` + "Queue a new ongoing goal, note, reusable skill, typed goal-plan change, or recurring goal schedule for user review. It does not activate the suggestion. For contradictory notes/plans, use kind conflict with title, body explaining the discrepancy, and 2-8 conflict_sources containing exact kind, ID, revision (note digest or plan revision as string), and source quote. Read sources first. This queues a review finding; accepting it only acknowledges review and does not choose a truth or edit sources. Propose source corrections separately. A goal proposal needs title, context in body, goal_outcome, and goal_steps; optional cron/timezone/task schedules read-only follow-up only after acceptance. use_current_source attaches the host-selected Work source, never a model-supplied path. For notes include exact source references when available. To update an existing note, read it with knowledge_read then supply note_id, expected_note_revision, title and the complete replacement body. Existing source references are preserved; do not create a duplicate note for a correction. For kind plan omit body; all edit fields belong in plan_change. For plan or schedule edits in a main chat, first local_plan read the selected goal and supply goal_id; plan_change.expected_revision must match that read. For update_step explicitly set plan_change.dependency_action: preserve for unchanged dependencies, replace with depends_on containing all desired IDs, or clear to remove all. A requested new dependency requires replace; including it only in a title or explanation does not record it. Step dependencies use existing step IDs or goal-ID/step-ID cross-project links (inspect both projects in the main chat first); time blocks need starts_at and ends_at with offsets. Recurring blocks also need recurrence frequency daily/weekly, interval and IANA timezone; no separate due_at. update_occurrence with date YYYY-MM-DD and status changes only that occurrence; marking the base step done ends the series. Status changes are user-reported, never inferred from elapsed time. Schedule suggestions require five-field cron, IANA timezone, and a bounded task; use change_only only for tasks independent of time passing.", Parameters: json.RawMessage(`{"type":"object","required":["kind"],"properties":{"kind":{"type":"string","enum":["goal","note","skill","plan","schedule","conflict"]},"title":{"type":"string","maxLength":256},"body":{"type":"string","maxLength":24576},"goal_outcome":{"type":"string","maxLength":2048},"goal_steps":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","maxLength":512}},"use_current_source":{"type":"boolean"},"source_refs":{"type":"array","maxItems":15,"items":{"type":"string","maxLength":512}},"note_id":{"type":"string","maxLength":29},"expected_note_revision":{"type":"string","maxLength":64},"skill_id":{"type":"string","maxLength":64},"description":{"type":"string","maxLength":512},"goal_id":{"type":"string","maxLength":29},"plan_change":{"type":"object","required":["kind","expected_revision"],"properties":{"kind":{"type":"string","enum":["set_outcome","add_step","update_step","remove_step","set_next_review","clear_next_review","mark_reviewed","update_occurrence","clear_occurrence"]},"expected_revision":{"type":"integer"},"step_id":{"type":"string"},"title":{"type":"string"},"status":{"type":"string","enum":["pending","doing","blocked","done"]},"due_at":{"type":"string","description":"RFC3339 with explicit offset"},"starts_at":{"type":"string","description":"RFC3339 with explicit offset; also supply ends_at"},"ends_at":{"type":"string"},"clear_schedule":{"type":"boolean"},"dependency_action":{"type":"string","enum":["preserve","replace","clear"],"description":"Required for update_step. Explicitly decide whether dependencies stay unchanged, are replaced by depends_on IDs, or are cleared."},"depends_on":{"type":"array","maxItems":8,"items":{"type":"string"}},"clear_dependencies":{"type":"boolean"},"clear_due":{"type":"boolean"},"evidence":{"type":"array","maxItems":8,"items":{"type":"string"}},"clear_evidence":{"type":"boolean"},"outcome":{"type":"string"},"next_review_at":{"type":"string"},"recurrence":{"type":"object","required":["frequency","interval","timezone"],"additionalProperties":false,"properties":{"frequency":{"type":"string","enum":["daily","weekly"]},"interval":{"type":"integer","minimum":1,"maximum":52},"timezone":{"type":"string"},"until":{"type":"string"}}},"clear_recurrence":{"type":"boolean"},"occurrence":{"type":"object","required":["date","status"],"additionalProperties":false,"properties":{"date":{"type":"string"},"status":{"type":"string","enum":["pending","doing","blocked","done","skipped"]},"starts_at":{"type":"string"},"ends_at":{"type":"string"}}}},"additionalProperties":false},"run_at":{"type":"string","description":"One-time execution timestamp in RFC3339 at minute precision; omit cron for one-time tasks."},"ends_at":{"type":"string","description":"Optional RFC3339 end boundary; use for a date-bounded recurring task."},"cron":{"type":"string","maxLength":256},"task":{"type":"string","maxLength":8192},"timezone":{"type":"string","maxLength":128},"change_only":{"type":"boolean"},"conflict_sources":{"type":"array","minItems":2,"maxItems":8,"items":{"type":"object","required":["kind","id","revision","quote"],"additionalProperties":false,"properties":{"kind":{"type":"string","enum":["note","plan"]},"id":{"type":"string"},"revision":{"type":"string"},"quote":{"type":"string","maxLength":1024}}}}},"additionalProperties":false}`)}
	var schema map[string]any
	_ = json.Unmarshal(definition.Parameters, &schema)
	schema["properties"].(map[string]any)["knowledge_sources"] = json.RawMessage(`{"type":"array","maxItems":8,"items":{"type":"string","maxLength":128}}`)
	schema["properties"].(map[string]any)["routine"] = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["parameters","sources","effects","max_requests","max_tokens"],"properties":{"parameters":{"type":"array","maxItems":16,"items":{"type":"object","additionalProperties":false,"required":["name","description"],"properties":{"name":{"type":"string","pattern":"^[a-z][a-z0-9_]{0,31}$"},"description":{"type":"string","maxLength":512}}}},"sources":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":1024}},"effects":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","enum":["read","draft","code","filesystem","browser","desktop","publish","settings"]}},"max_requests":{"type":"integer","minimum":1,"maximum":128},"max_tokens":{"type":"integer","minimum":1000,"maximum":1000000}}}`)
	definition.Parameters, _ = json.Marshal(schema)
	definition.Description += " To save a reusable parameterized routine, use kind skill with skill_id, description, procedure body using {{parameter_name}} slots, and routine metadata containing parameters, source prerequisites, effect labels and request/token limits. Include steps and their verification in the procedure. Saving requires user acceptance and reuse requires skill_prepare review. Routine metadata grants no permissions. When a note or routine derives from saved memories/notes/skills, provide their exact IDs in knowledge_sources. The host pins current source revisions; changed or forgotten sources invalidate the derived item. Captured provenance is supplied by the host."
	return definition

}

func (t SuggestChange) Execute(_ context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var args struct {
		KnowledgeSources     []string                `json:"knowledge_sources"`
		Routine              *knowledge.Routine      `json:"routine"`
		ConflictSources      []reconciliation.Source `json:"conflict_sources"`
		GoalID               string                  `json:"goal_id"`
		NoteID               string                  `json:"note_id"`
		ExpectedNoteRevision string                  `json:"expected_note_revision"`
		Kind                 string                  `json:"kind"`
		Title                string                  `json:"title"`
		Body                 string                  `json:"body"`
		GoalOutcome          string                  `json:"goal_outcome"`
		GoalSteps            []string                `json:"goal_steps"`
		UseCurrentSource     bool                    `json:"use_current_source"`
		SourceRefs           []string                `json:"source_refs"`
		SkillID              string                  `json:"skill_id"`
		Description          string                  `json:"description"`
		PlanChange           struct {
			goal.PlanChange
			DependencyAction string `json:"dependency_action"`
		} `json:"plan_change"`
		RunAt      time.Time `json:"run_at"`
		EndsAt     time.Time `json:"ends_at"`
		Cron       string    `json:"cron"`
		Task       string    `json:"task"`
		Timezone   string    `json:"timezone"`
		ChangeOnly bool      `json:"change_only"`
	}
	if err := decodeArguments(raw, &args); err != nil {
		return agent.ToolResult{}, err
	}
	if args.Kind == "plan" && args.PlanChange.Kind == "update_step" {
		switch args.PlanChange.DependencyAction {
		case "preserve":
			if args.PlanChange.DependsOn != nil || args.PlanChange.ClearDependencies {
				return agent.ToolResult{}, errors.New("dependency_action preserve cannot include depends_on or clear_dependencies; use replace or clear")
			}
		case "replace":
			if len(args.PlanChange.DependsOn) == 0 || args.PlanChange.ClearDependencies {
				return agent.ToolResult{}, errors.New("dependency_action replace needs all desired depends_on step IDs and cannot clear dependencies")
			}
		case "clear":
			if args.PlanChange.DependsOn != nil {
				return agent.ToolResult{}, errors.New("dependency_action clear cannot include depends_on")
			}
			args.PlanChange.ClearDependencies = true
		default:
			return agent.ToolResult{}, errors.New("update_step requires plan_change.dependency_action: preserve for unchanged dependencies, replace with all desired depends_on step IDs, or clear to remove them; no suggestion was queued")
		}
	} else if args.PlanChange.DependencyAction != "" {
		return agent.ToolResult{}, fmt.Errorf(`dependency_action requires root kind:"plan" and plan_change.kind:"update_step"; received root kind:%q and plan_change.kind:%q. Correct that nesting and retain all requested depends_on and schedule fields`, args.Kind, args.PlanChange.Kind)
	}
	if args.Kind != "conflict" && args.Kind != "goal" && args.Kind != "note" && args.Kind != "skill" && args.Kind != "plan" && args.Kind != "schedule" {
		return agent.ToolResult{}, errors.New("suggestion kind must be goal, note, skill, plan, schedule, or conflict")
	}
	if args.Kind == "goal" && t.GoalID != "" {
		return agent.ToolResult{}, errors.New("new goal suggestions require the main conversation, not an existing goal")
	}
	if args.Kind == "plan" && t.GoalID == "" && args.GoalID == "" {
		return agent.ToolResult{}, errors.New("plan and schedule suggestions require an active goal")
	}
	goalID := t.GoalID
	if args.GoalID != "" {
		if (args.Kind != "plan" && args.Kind != "schedule") || t.Plans == nil || !t.Plans.allowed(args.GoalID) {
			return agent.ToolResult{}, errors.New("target goal is outside this proposal's scope")
		}
		record, err := t.Plans.Store.Load(args.GoalID)
		if err != nil {
			return agent.ToolResult{}, err
		}
		if record.Status != goal.Active {
			return agent.ToolResult{}, errors.New("target goal is not active")
		}
		plan, err := t.Plans.Store.LoadPlan(args.GoalID)
		if err != nil {
			return agent.ToolResult{}, err
		}
		if !t.Plans.inspectedRevision(args.GoalID, plan.Revision) || args.Kind == "plan" && args.PlanChange.ExpectedRevision != plan.Revision {
			return agent.ToolResult{}, errors.New("read the current target with local_plan before suggesting a change")
		}
		goalID = args.GoalID
	}

	for _, ref := range args.PlanChange.DependsOn {
		if target, _, linked := strings.Cut(ref, "/"); linked && target != goalID {
			if t.GoalID != "" || t.Plans == nil || !t.Plans.allowed(target) {
				return agent.ToolResult{}, errors.New("new cross-project links require the main chat and an inspected target")
			}
			plan, err := t.Plans.Store.LoadPlan(target)
			if err != nil {
				return agent.ToolResult{}, err
			}
			if !t.Plans.inspectedRevision(target, plan.Revision) {
				return agent.ToolResult{}, errors.New("inspect the dependency project before linking it")
			}
		}
	}

	if args.NoteID != "" {
		if args.Kind != "note" || t.Notes == nil || slices.Contains(t.ExcludedIDs, args.NoteID) {
			return agent.ToolResult{}, errors.New("note is not available for updates in this run")
		}
		note, err := t.Notes.LoadNote(args.NoteID)
		if err != nil {
			return agent.ToolResult{}, err
		}
		if note.GoalID != "" && note.GoalID != t.GoalID {
			return agent.ToolResult{}, errors.New("note is outside this goal")
		}
		if args.ExpectedNoteRevision == "" || note.Revision() != args.ExpectedNoteRevision {
			return agent.ToolResult{}, errors.New("note changed; read it again before suggesting an update")
		}
		goalID = note.GoalID
	}
	if args.Kind == "skill" {
		goalID = ""
	}
	if args.Kind == "plan" && strings.TrimSpace(args.Body) != "" {
		return agent.ToolResult{}, errors.New("plan changes must use plan_change, not body text; remove body and retain the requested dependency_action, depends_on, scheduling and status fields inside plan_change")
	}
	goalSource := ""
	if args.Kind == "goal" && args.UseCurrentSource {
		if t.SourcePath == "" {
			return agent.ToolResult{}, errors.New("this Work run has no selected source directory")
		}
		var err error
		goalSource, err = filepath.Abs(t.SourcePath)
		if err != nil {
			return agent.ToolResult{}, err
		}
		goalSource, err = filepath.EvalSymlinks(goalSource)
		if err != nil {
			return agent.ToolResult{}, err
		}
	}

	if args.Kind == "conflict" {
		if t.Plans == nil || t.Notes == nil {
			return agent.ToolResult{}, errors.New("conflict review needs local knowledge and planning tools")
		}
		if err := reconciliation.Check(t.Plans.Store, *t.Notes, args.ConflictSources, t.GoalID, t.Plans.AllowGlobal, t.ExcludedIDs); err != nil {
			return agent.ToolResult{}, err
		}
	}
	if args.Routine != nil {
		args.Routine.CapturedFrom = t.WorkID
	}
	var deps []knowledge.Dependency
	if len(args.KnowledgeSources) > 0 {
		if t.Notes == nil || args.Kind != "note" && args.Kind != "skill" {
			return agent.ToolResult{}, errors.New("knowledge sources belong to saved notes and routines")
		}
		var err error
		deps, _, err = t.Notes.CaptureDependencies(args.KnowledgeSources, goalID, t.ExcludedIDs)
		if err != nil {
			return agent.ToolResult{}, err
		}
	}
	var err error
	sourcePath := ""
	if args.Kind == "schedule" && goalID == "" {
		if t.SourcePath == "" {
			return agent.ToolResult{}, errors.New("select a workspace before creating a standalone scheduled task")
		}
		sourcePath, err = filepath.Abs(t.SourcePath)
		if err != nil {
			return agent.ToolResult{}, err
		}
	}
	record, err := t.Store.Create(suggestion.Record{OriginConversationID: t.ConversationID, SourcePath: sourcePath, Dependencies: deps, Routine: args.Routine, ConflictSources: args.ConflictSources, NoteID: args.NoteID, ExpectedNoteRevision: args.ExpectedNoteRevision, Kind: args.Kind, Title: args.Title, Body: args.Body, GoalSourcePath: goalSource, GoalOutcome: args.GoalOutcome, GoalSteps: args.GoalSteps, SourceRefs: args.SourceRefs, SkillID: args.SkillID, Description: args.Description, GoalID: goalID, WorkID: t.WorkID, PlanChange: args.PlanChange.PlanChange, RunAt: args.RunAt, EndsAt: args.EndsAt, Cron: args.Cron, Task: args.Task, Timezone: args.Timezone, ChangeOnly: args.ChangeOnly})
	if err != nil {
		return agent.ToolResult{}, err
	}
	content, err := success(map[string]any{"id": record.ID, "status": record.Status, "kind": record.Kind, "review": "hot-cross-buns suggestion show " + record.ID + "; hot-cross-buns suggestion accept " + record.ID})
	return agent.ToolResult{Content: content}, err
}
