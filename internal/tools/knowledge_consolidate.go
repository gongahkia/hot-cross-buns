package tools

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"strings"
)

type ConsolidateKnowledge struct {
	Store       knowledge.Store
	GoalID      string
	ExcludedIDs []string
	Review      func(context.Context, any) (bool, error)
}

func (ConsolidateKnowledge) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "knowledge_consolidate", Description: "Propose a compact saved summary of 1-8 inspected saved memories/notes/skills for foreground user review. Supply source IDs, title and proposed body. Every claim must be supported by those exact sources; preserve uncertainty, ownership, plans versus outcomes and contradictions. No background execution. Review shows original sources and the proposed summary. Approval saves a derived note with pinned source revisions; later correction, forgetting, invalid source or disabled skill makes it unavailable for recall. For edits to an existing note use suggest_change with its inspected revision and knowledge_sources; for personal-fact merges use the existing memory reconciliation review.", Parameters: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["sources","title","body"],"properties":{"sources":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","maxLength":128}},"title":{"type":"string","maxLength":256},"body":{"type":"string","maxLength":8192}}}`)}
}
func (t ConsolidateKnowledge) Execute(ctx context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var a struct {
		Sources     []string
		Title, Body string
	}
	if err := decodeArguments(raw, &a); err != nil {
		return agent.ToolResult{}, err
	}
	if t.Review == nil {
		return agent.ToolResult{}, errors.New("consolidation needs foreground review")
	}
	if len(a.Title) > 256 || len(a.Body) > 8192 || strings.TrimSpace(a.Body) == "" {
		return agent.ToolResult{}, errors.New("provide a bounded title and evidence-backed summary")
	}
	deps, sources, err := t.Store.CaptureDependencies(a.Sources, t.GoalID, t.ExcludedIDs)
	if err != nil {
		return agent.ToolResult{}, err
	}
	ok, err := t.Review(ctx, map[string]any{"setting": "memory", "action": "consolidate", "sources": sources, "source_revisions": deps, "proposed_title": a.Title, "proposed_summary": a.Body, "effect": "Save this reviewed summary as derived reference data. The originals stay intact; source changes invalidate future recall. This review does not establish independent factual correctness."})
	if err != nil {
		return agent.ToolResult{}, err
	}
	if !ok {
		return agent.ToolResult{}, errors.New("consolidation declined; nothing saved")
	}
	if err := ctx.Err(); err != nil {
		return agent.ToolResult{}, err
	}
	note, err := t.Store.AddDerivedNote(a.Title, a.Body, t.GoalID, deps)
	if err != nil {
		return agent.ToolResult{}, err
	}
	content, err := success(map[string]any{"saved": true, "id": note.ID, "revision": note.Revision(), "dependencies": deps, "authority": "derived reference data only"})
	return agent.ToolResult{Content: content}, err
}
