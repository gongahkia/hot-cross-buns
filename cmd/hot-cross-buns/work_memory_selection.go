package main

import (
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/workhistory"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"strings"
)

func applyKnowledgeSelection(state string, request *workrun.Request) error {
	notes, err := knowledge.Open(state)
	if err != nil {
		return err
	}
	mem, err := memory.Open(state)
	if err != nil {
		return err
	}
	records, err := mem.List(request.GoalID, true)
	if err != nil && memory.ReadWarning(err) == "" {
		return err
	}
	byID := map[string]memory.Record{}
	items := map[string]workhistory.ContextItem{}
	for _, r := range records {
		byID[r.ID] = r
	}
	for _, item := range request.ContextItems {
		items[item.ID] = item
	}
	query := request.Objective + " " + request.GoalContext
	// A user pin can add an eligible item omitted by the relevance shortlist;
	// it cannot override conditional applicability or any source/privacy boundary.
	for _, r := range records {
		if r.Policy != nil && r.Policy.Pinned {
			if _, found := items[r.ID]; !found {
				items[r.ID] = workhistory.ContextItem{ID: r.ID, Kind: "memory", Title: r.Kind, Excerpt: boundedContextExcerpt(r.Text), Scope: contextScope(r.GoalID), Source: r.Source, UpdatedAt: r.UpdatedAt}
			}
		}
	}
	if saved, err := notes.ListNotes(request.GoalID); err == nil {
		for _, d := range saved {
			if d.Policy != nil && d.Policy.Pinned {
				if _, found := items[d.ID]; !found {
					items[d.ID] = workhistory.ContextItem{ID: d.ID, Kind: "note", Title: d.Title, Scope: contextScope(d.GoalID), UpdatedAt: d.UpdatedAt}
				}
			}
		}
	}
	candidates := []knowledge.RecallCandidate{}
	original := map[string]workhistory.ContextItem{}
	for _, item := range request.ContextItems {
		original[item.ID] = item
	}
	// Preserve the stable shortlist order; pins follow it instead of map ordering.
	ordered := append([]workhistory.ContextItem(nil), request.ContextItems...)
	for _, r := range records {
		if _, ok := original[r.ID]; !ok {
			if item, found := items[r.ID]; found {
				ordered = append(ordered, item)
			}
		}
	}
	for id, item := range items {
		if item.Kind == "note" {
			if _, found := original[id]; !found {
				ordered = append(ordered, item)
			}
		}
	}
	unaffected := []workhistory.ContextItem{}
	for _, item := range ordered {
		if item.Kind != "memory" && item.Kind != "note" {
			unaffected = append(unaffected, item)
			continue
		}
		c := knowledge.RecallCandidate{ID: item.ID, Kind: item.Kind, Eligible: true, Priority: 2, Reason: "task relevance shortlist", Text: fmt.Sprintf("- [%s] %s: %s", item.ID, safeNoteContext(item.Title), safeNoteContext(item.Excerpt))}
		if item.Kind == "note" {
			d, err := notes.LoadNote(item.ID)
			if err != nil || d.SourceIssue != "" {
				c.Eligible = false
				c.Reason = "derived source changed or unavailable"
			} else {
				if d.Policy != nil && d.Policy.Pinned {
					c.Priority += 8
					c.Reason = "pinned by you, within current scope"
				}
				c.Revision = d.Revision()
				item.Excerpt = boundedContextExcerpt(d.Body)
				item.UpdatedAt = d.UpdatedAt
				items[item.ID] = item
				c.Text = fmt.Sprintf("- [%s] %s (excerpt; read full note before relying on omitted details): %s", item.ID, safeNoteContext(d.Title), safeNoteContext(item.Excerpt))
			}
		}
		if item.Kind == "memory" {
			r, ok := byID[item.ID]
			if !ok {
				c.Eligible = false
				c.Reason = "source no longer available"
			} else {
				c.Revision = r.Revision()
				c.Text = memory.Render([]memory.Record{r})
				if !r.Recallable() || !r.Applies(query) {
					c.Eligible = false
					c.Reason = "source needs review or does not apply to this task"
				}
				if r.Policy != nil && r.Policy.Pinned {
					c.Priority += 8
					c.Reason = "pinned by you, within current scope"
				}
				if r.Context != nil && r.Context.Importance == "constraint" {
					c.Priority += 4
					c.Reason += "; reviewed constraint"
				}
			}
		}
		if sliceHas(request.ExcludedKnowledgeIDs, item.ID) {
			c.Eligible = false
			c.Reason = "excluded by you for this task"
		}
		candidates = append(candidates, c)
	}
	selected, trace := knowledge.SelectRecall(candidates, 4096)
	// Add identifier-only explanations for screened memories; never retain an
	// omitted fact's text or imply it reached the model.
	traced := map[string]bool{}
	for _, r := range trace {
		traced[r.ID] = true
	}
	for _, r := range records {
		if !traced[r.ID] && len(trace) < 128 {
			reason := "not selected by task relevance"
			if sliceHas(request.ExcludedKnowledgeIDs, r.ID) {
				reason = "excluded by you for this task"
			} else if !r.Recallable() {
				reason = "source needs review, expired or snoozed"
			} else if !r.Applies(query) {
				reason = "conditional context does not apply"
			}
			trace = append(trace, knowledge.RecallTrace{ID: r.ID, Kind: "memory", Revision: r.Revision(), Reason: reason})
		}
	}
	var memoryLines, noteLines []string
	request.ContextItems = unaffected
	request.ContextRefs = nil
	for _, item := range unaffected {
		request.ContextRefs = append(request.ContextRefs, item.ID)
	}
	for _, chosen := range selected {
		item := items[chosen.ID]
		item.SelectionReason = chosen.Reason
		item.Revision = chosen.Revision
		request.ContextItems = append(request.ContextItems, item)
		request.ContextRefs = append(request.ContextRefs, item.ID)
		if chosen.Kind == "memory" {
			memoryLines = append(memoryLines, chosen.Text)
		} else {
			noteLines = append(noteLines, chosen.Text)
		}
	}
	request.MemoryContext = strings.Join(memoryLines, "\n")
	request.NoteContext = strings.Join(noteLines, "\n")
	request.RecallTrace = trace
	appendRecallStatus(request, "Selection", "shared 4096-token conservative UTF-8 byte ceiling; inspect knowledge_search/knowledge_read when required context is missing")
	return nil
}
