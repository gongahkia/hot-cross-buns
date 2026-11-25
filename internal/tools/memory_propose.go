package tools

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

type proposeMemory struct{ ChatMemory }

func (proposeMemory) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "memory_propose", Description: "Propose potentially useful personal/goal context for the person's review, without activating it. Use for significant decisions, plans, conditional preferences or uncertain future usefulness. Quote the CURRENT user's exact words; give a reason for future usefulness and explicit state (planned is not occurred). context dates are absolute RFC3339 with IANA timezone; do not invent dates from ambiguous relative wording. applies_to contains optional task topics restricting automatic recall. No secrets, third-party facts or withdrawn topics. A candidate is not a saved active memory; tell the user to review it in Memory → Suggestions. Clear enduring user preferences still use memory_remember.", Parameters: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["subject","kind","quote","scope","context"],"properties":{"subject":{"type":"string","maxLength":96},"kind":{"type":"string","enum":["fact","preference","decision"]},"quote":{"type":"string","maxLength":2000},"scope":{"type":"string","enum":["personal","goal"]},"context":{"type":"object","additionalProperties":false,"required":["why","importance","state"],"properties":{"why":{"type":"string","maxLength":512},"importance":{"type":"string","enum":["constraint","useful","incidental"]},"state":{"type":"string","enum":["current","planned","occurred","cancelled","historical"]},"entity":{"type":"string","maxLength":128},"applies_to":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":80}},"valid_from":{"type":"string"},"valid_until":{"type":"string"},"timezone":{"type":"string"}}}}}`)}
}
func (t proposeMemory) Execute(ctx context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var a struct {
		Subject, Kind, Quote, Scope string
		Context                     *memory.Context
	}
	if err := decodeArguments(raw, &a); err != nil {
		return agent.ToolResult{}, err
	}
	if !t.evidence(a.Quote) || negativeRemember.MatchString(t.UserMessage) {
		return agent.ToolResult{}, errors.New("memory proposal needs permitted exact evidence from the current user")
	}
	deny, _ := memorySuitability(t.UserMessage, a.Quote)
	if deny != "" {
		return agent.ToolResult{}, errors.New(deny)
	}
	if memoryReported.MatchString(t.UserMessage) {
		return agent.ToolResult{}, errors.New("clarify ownership before proposing quoted or third-party context")
	}
	explicit := rememberIntent.MatchString(t.UserMessage)
	if !t.Automatic && !explicit {
		return agent.ToolResult{}, errors.New("chat learning is off; an explicit remember request is required")
	}
	goal := ""
	if a.Scope == "goal" && t.GoalID != "" {
		goal = t.GoalID
	} else if a.Scope != "personal" {
		return agent.ToolResult{}, errors.New("choose personal scope or this task's current goal")
	}
	if a.Context == nil {
		return agent.ToolResult{}, errors.New("explain significance and temporal applicability")
	}
	if err := a.Context.Validate(); err != nil {
		return agent.ToolResult{}, err
	}
	if t.Semantics == nil {
		return agent.ToolResult{}, errors.New("semantic review is unavailable for this memory proposal")
	}
	input := memory.ChatInput{Subject: a.Subject, Kind: a.Kind, Quote: a.Quote, GoalID: goal, ConversationID: t.ConversationID, RunID: t.RunID, Context: a.Context, ExcludedIDs: t.ExcludedIDs}
	plan, err := t.Store.AnalyzeChat(ctx, t.Semantics, input, t.UserMessage)
	if err != nil {
		return agent.ToolResult{}, err
	}
	proposal, err := t.Store.ProposeCandidate(ctx, input, plan)
	if err != nil {
		return agent.ToolResult{}, err
	}
	content, err := success(map[string]any{"active": false, "requires_review": true, "candidate": proposal.ID, "status": proposal.Status, "why": a.Context.Why, "state": a.Context.State})
	return agent.ToolResult{Content: content}, err
}
