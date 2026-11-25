package tools

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
)

type PrepareSkill struct {
	Store      knowledge.Store
	Budget     *agent.Budget
	Review     func(context.Context, any) (bool, error)
	Activate   func([]string)
	CheckReady func() error
}

func (PrepareSkill) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "skill_prepare", Description: "Prepare a saved routine with exact parameter values for foreground user review. Inspect skill_list/skill_read first. Approval selects this procedure and narrows the remaining model budget; it never grants files, accounts, computer access or external actions. Execute steps using ordinary scoped tools, verify each outcome, and inspect retained work/receipts before recovery. Do not repeat completed or uncertain external actions.", Parameters: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["name","parameters"],"properties":{"name":{"type":"string","maxLength":64},"parameters":{"type":"object","maxProperties":16,"additionalProperties":{"type":"string","maxLength":4096}}}}`)}
}

func (t PrepareSkill) Execute(ctx context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var args struct {
		Name       string            `json:"name"`
		Parameters map[string]string `json:"parameters"`
	}
	if err := decodeArguments(raw, &args); err != nil {
		return agent.ToolResult{}, err
	}
	if t.Review == nil || t.Budget == nil || t.Activate == nil {
		return agent.ToolResult{}, errors.New("routine activation requires a foreground review and the current task budget")
	}
	if t.CheckReady != nil {
		if err := t.CheckReady(); err != nil {
			return agent.ToolResult{}, err
		}
	}
	skill, err := t.Store.LoadSkill(args.Name)
	if err != nil {
		return agent.ToolResult{}, err
	}
	if !skill.Enabled || skill.Routine == nil {
		return agent.ToolResult{}, errors.New("choose an enabled parameterized routine from the skills library")
	}
	procedure, err := skill.Routine.Expand(skill.Body, args.Parameters)
	if err != nil {
		return agent.ToolResult{}, err
	}
	revision := skill.Revision()
	preview := map[string]any{"setting": "routine", "action": "use", "name": skill.ID, "description": skill.Description, "parameters": args.Parameters, "procedure": procedure, "sources": skill.Routine.Sources, "effects": skill.Routine.Effects, "max_additional_model_requests": skill.Routine.MaxRequests, "max_additional_reported_tokens": skill.Routine.MaxTokens, "effect": "Use this procedure for the current task only, within its existing limits and permissions. Sources are prerequisites, not access grants. Completed work and uncertain external actions must be inspected before recovery. These limits cover HCB-managed model calls; CLI workers retain their separate execution limits."}
	approved, err := t.Review(ctx, preview)
	if err != nil {
		return agent.ToolResult{}, err
	}
	if !approved {
		return agent.ToolResult{}, errors.New("routine use declined; no routine was activated")
	}
	if err := ctx.Err(); err != nil {
		return agent.ToolResult{}, err
	}
	current, err := t.Store.LoadSkill(skill.ID)
	if err != nil {
		return agent.ToolResult{}, err
	}
	if !current.Enabled || current.Revision() != revision {
		return agent.ToolResult{}, errors.New("routine changed during review; inspect and prepare the current revision again")
	}
	if t.CheckReady != nil {
		if err := t.CheckReady(); err != nil {
			return agent.ToolResult{}, err
		}
	}
	if err := t.Budget.RestrictRemaining(skill.Routine.MaxRequests, skill.Routine.MaxTokens); err != nil {
		return agent.ToolResult{}, err
	}
	t.Activate(append([]string(nil), skill.Routine.Effects...))
	content, err := success(map[string]any{"name": skill.ID, "revision": revision, "parameters": args.Parameters, "procedure": procedure, "sources": skill.Routine.Sources, "effects": skill.Routine.Effects, "authority": "reviewed task guidance only; all existing permissions, exact-action reviews, execution limits and recovery checks still apply"})
	return agent.ToolResult{Content: content}, err
}
