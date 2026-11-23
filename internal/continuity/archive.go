package continuity

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

type archiveContext struct {
	recent, tasks []worksession.ContextTurn
	summary       string
	covered       int
	notices       []string
}

func prepareArchive(ctx context.Context, s worksession.Store, memories memory.Store, model agent.Model, records []memory.Record, rules []memory.WithdrawalRule, o Options) (archiveContext, error) {
	var result archiveContext
	q := worksession.HistoryQuery{Chat: o.ConversationID, Before: o.BeforeSequence, At: o.BeforeTime, Limit: 11}
	indexCtx, cancelIndex := context.WithTimeout(ctx, 2*time.Second)
	more, indexErr := s.SyncHistory(indexCtx, o.ConversationID, 128)
	cancelIndex()
	versions := map[string]string{}
	for _, record := range records {
		versions[record.ID] = hash(record)
	}
	if indexErr == nil {
		indexErr = s.ReconcileHistoryMemories(ctx, q.Chat, versions)
	}
	var recent worksession.HistoryPage
	if indexErr == nil {
		recent, indexErr = s.ReadHistory(ctx, q)
	}
	if indexErr != nil {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		result.notices = append(result.notices, "The archive index is unavailable. This reply uses recent canonical messages and current memory; older recall is incomplete.")
		page, _, err := s.DialoguePage(o.ConversationID, o.BeforeSequence, 8)
		if err == nil {
			for _, t := range page {
				if !o.BeforeTime.IsZero() && t.UpdatedAt.After(o.BeforeTime) {
					continue
				}
				result.recent = append(result.recent, worksession.ContextTurn{ID: "dialogue:" + t.ID, Sequence: t.Sequence, User: t.Text, Assistant: t.Response, State: t.State, TaskChat: t.TaskChat, At: t.CreatedAt})
			}
		}
		return result, nil
	}
	if more || recent.Incomplete {
		result.notices = append(result.notices, "The archive index is still catching up or repairing sources. Older recall may be incomplete; new messages remain usable.")
	}
	policy := hash(struct {
		Rules    []memory.WithdrawalRule
		Excluded []string
		Goal     string
	}{rules, o.Excluded, o.GoalID})
	nodes, err := s.ReadHistoryNodes(ctx, q)
	if err != nil {
		return archiveFallback(result, recent.Turns), nil
	}
	// Recheck only selected summary sections when withdrawal policy changes.
	for pass := 0; pass < 2; pass++ {
		changed := false
		for _, n := range nodes {
			if n.Policy == policy {
				continue
			}
			allowed, err := screen(ctx, memories, model, o.GoalID, []worksession.ContextTurn{{ID: n.ID, User: n.Text, At: time.Unix(0, n.FirstAt)}})
			if err != nil {
				return result, err
			}
			blocked := len(allowed) == 0
			if err := s.SetHistoryNodePolicy(ctx, n, policy, blocked); err != nil {
				return archiveFallback(result, recent.Turns), nil
			}
			changed = changed || blocked
		}
		if !changed {
			break
		}
		nodes, err = s.ReadHistoryNodes(ctx, q)
		if err != nil {
			return archiveFallback(result, recent.Turns), nil
		}
	}
	past, err := s.HistoryIsPast(ctx, q)
	if err != nil {
		return archiveFallback(result, recent.Turns), nil
	}
	keep := map[string]bool{}
	for _, t := range recent.Turns[max(0, len(recent.Turns)-recentTurns):] {
		keep[t.ID] = true
	}
	pendingQuery := q
	pendingQuery.Limit = 32
	pendingQuery.Uncovered = true
	pending, err := s.ReadHistory(ctx, pendingQuery)
	if err != nil {
		return archiveFallback(result, recent.Turns), nil
	}
	var batch []worksession.ContextTurn
	bytes := 0
	for _, t := range pending.Turns {
		if keep[t.ID] || t.State == "unconfirmed_at_admission" {
			continue
		}
		n := min(16*1024, len(t.User)+len(t.Assistant))
		if len(batch) > 0 && bytes+n > maxBatchBytes {
			break
		}
		batch = append(batch, t)
		bytes += n
	}
	budget := 2
	if len(batch) >= 4 || bytes > 32*1024 {
		safe, err := screen(ctx, memories, model, o.GoalID, batch)
		if err != nil {
			return result, err
		}
		text, err := summarize(ctx, model, "", safe)
		if err != nil {
			result.notices = append(result.notices, "Earlier section summarization is temporarily unavailable; original history remains searchable.")
		} else {
			budget--
			if past {
				result.summary = text
				result.covered = len(batch)
			} else {
				n := worksession.HistoryNode{Chat: q.Chat, Level: 0, Text: text, Policy: policy}
				var parts []string
				memoryDeps := map[string]bool{}
				for _, t := range batch {
					digest := worksession.ContextDigest([]worksession.ContextTurn{t})
					n.Dependencies = append(n.Dependencies, worksession.HistoryDependency{Kind: "source", Key: t.ID, Digest: digest})
					parts = append(parts, t.ID, digest)
					prior, err := s.HistoryMemoryDependencies(ctx, q.Chat, t.ID)
					if err != nil {
						return archiveFallback(result, recent.Turns), nil
					}
					for _, id := range prior {
						memoryDeps[id] = true
					}
					for _, record := range records {
						if record.Origin != nil && record.Origin.ConversationID == q.Chat && record.Origin.Quote != "" && strings.Contains(t.User, record.Origin.Quote) {
							memoryDeps[record.ID] = true
						}
					}
				}
				memoryIDs := make([]string, 0, len(memoryDeps))
				for id := range memoryDeps {
					memoryIDs = append(memoryIDs, id)
				}
				sort.Strings(memoryIDs)
				for _, id := range memoryIDs {
					digest := versions[id]
					if digest == "" {
						digest = "missing"
					}
					n.Dependencies = append(n.Dependencies, worksession.HistoryDependency{Kind: "memory", Key: id, Digest: digest})
				}
				n.ID = worksession.HistoryNodeID("section", parts...)
				if err := s.SaveHistoryNode(ctx, n); err != nil {
					result.notices = append(result.notices, "A summary source changed during publication; that section will be prepared again.")
				}
			}
		}
	}
	if !past {
		for budget > 0 {
			nodes, err = s.ReadHistoryNodes(ctx, q)
			if err != nil {
				return archiveFallback(result, recent.Turns), nil
			}
			left, right := -1, -1
			for i := range nodes {
				for j := i + 1; j < len(nodes); j++ {
					if nodes[i].Level == nodes[j].Level && (left < 0 || nodes[i].Level < nodes[left].Level) {
						left, right = i, j
					}
				}
			}
			if left < 0 {
				break
			}
			a, b := nodes[left], nodes[right]
			text, err := summarize(ctx, model, "", []worksession.ContextTurn{{ID: a.ID, User: a.Text, State: "source_section_summary"}, {ID: b.ID, User: b.Text, State: "source_section_summary"}})
			budget--
			if err != nil {
				result.notices = append(result.notices, "Summary overview maintenance is incomplete; the underlying sections remain available.")
				break
			}
			n := worksession.HistoryNode{Chat: q.Chat, ID: worksession.HistoryNodeID("overview", a.ID, a.Digest, b.ID, b.Digest), Level: a.Level + 1, Text: text, Policy: policy, Dependencies: []worksession.HistoryDependency{{Kind: "node", Key: a.ID, Digest: a.Digest}, {Kind: "node", Key: b.ID, Digest: b.Digest}}}
			if err := s.SaveHistoryNode(ctx, n); err != nil {
				break
			}
		}
	}
	nodes, err = s.ReadHistoryNodes(ctx, q)
	if err != nil {
		return archiveFallback(result, recent.Turns), nil
	}
	for _, n := range nodes {
		if n.Policy != policy {
			allowed, err := screen(ctx, memories, model, o.GoalID, []worksession.ContextTurn{{ID: n.ID, User: n.Text, At: time.Unix(0, n.FirstAt)}})
			if err != nil {
				return result, err
			}
			if len(allowed) == 0 {
				continue
			}
		}
		result.covered += n.Covered
		result.summary += fmt.Sprintf("Section %s:\n%s\n", n.ID, Clip(n.Text, max(256, 10*1024/max(1, len(nodes)))))
	}
	result.summary = Clip(result.summary, 12*1024)
	// Keep additional unsummarized recent turns until the next section batch.
	pending, err = s.ReadHistory(ctx, pendingQuery)
	if err != nil {
		return archiveFallback(result, recent.Turns), nil
	}
	uncovered := map[string]bool{}
	for _, t := range pending.Turns {
		uncovered[t.ID] = true
	}
	for _, t := range recent.Turns {
		if keep[t.ID] || uncovered[t.ID] {
			result.recent = append(result.recent, t)
		}
	}
	if result.covered+len(result.recent) < recent.Total {
		result.notices = append(result.notices, "Some indexed older turns are not summarized yet. Relevant original excerpts can still be retrieved.")
	}
	taskQuery := q
	taskQuery.Tasks = true
	taskQuery.Limit = 9
	taskPage, err := s.ReadHistory(ctx, taskQuery)
	if err == nil {
		result.tasks = taskPage.Turns
	}
	if !past {
		view, err := s.ReadContinuity(q.Chat)
		if err == nil && (result.summary != "" || view.Revision > 0) {
			text := result.summary
			if text == "" && result.covered > 0 {
				text = "Earlier context was withheld by current privacy rules."
			}
			data, _ := json.Marshal(nodes)
			digest := hash(string(data))
			if view.Text != text || view.Digest != digest || view.Covered != result.covered || view.Epoch != policy {
				_ = s.SaveContinuity(worksession.ContinuitySummary{ConversationID: q.Chat, Epoch: policy, Covered: result.covered, Digest: digest, Text: text, UpdatedAt: time.Now().UTC()}, view.Revision)
			}
		}
	}
	return result, nil
}

func archiveFallback(r archiveContext, recent []worksession.ContextTurn) archiveContext {
	r.recent = recent
	r.summary = ""
	r.covered = 0
	r.notices = append(r.notices, "Archive summaries are temporarily unavailable; current messages and memories remain usable.")
	return r
}
