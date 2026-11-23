package worksession

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistorySectionsInvalidateOnlyAffectedDependencies(t *testing.T) {
	ctx := context.Background()
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	a, err := s.AdmitDialogue(chat.ID, "section-message-one-001", "First source", json.RawMessage(`{}`), time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.AdmitDialogue(chat.ID, "section-message-two-002", "Unrelated source", json.RawMessage(`{}`), time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	makeLeaf := func(id string, r DialogueTurn, mem string) HistoryNode {
		t.Helper()
		_, digest, err := s.ReadHistoryTurn(ctx, chat.ID, "dialogue:"+r.ID)
		if err != nil {
			t.Fatal(err)
		}
		n := HistoryNode{Chat: chat.ID, ID: id, Text: id + " summary", Policy: "p", Dependencies: []HistoryDependency{{Kind: "source", Key: "dialogue:" + r.ID, Digest: digest}}}
		if mem != "" {
			n.Dependencies = append(n.Dependencies, HistoryDependency{Kind: "memory", Key: mem, Digest: "v1"})
		}
		if err := s.SaveHistoryNode(ctx, n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	left := makeLeaf("left", a, "m1")
	right := makeLeaf("right", b, "")
	q := HistoryQuery{Chat: chat.ID, Limit: 8}
	nodes, err := s.ReadHistoryNodes(ctx, q)
	if err != nil || len(nodes) != 2 {
		t.Fatal(nodes, err)
	}
	parent := HistoryNode{Chat: chat.ID, ID: "parent", Level: 1, Text: "Overview", Policy: "p"}
	for _, n := range nodes {
		parent.Dependencies = append(parent.Dependencies, HistoryDependency{Kind: "node", Key: n.ID, Digest: n.Digest})
	}
	if err := s.SaveHistoryNode(ctx, parent); err != nil {
		t.Fatal(err)
	}
	nodes, err = s.ReadHistoryNodes(ctx, q)
	if err != nil || len(nodes) != 1 || nodes[0].Covered != 2 {
		t.Fatal(nodes, err)
	}
	// Editing an unrelated memory must not invalidate either the parent or its leaves.
	if err := s.ReconcileHistoryMemories(ctx, chat.ID, map[string]string{"m1": "v1", "other": "v2"}); err != nil {
		t.Fatal(err)
	}
	nodes, _ = s.ReadHistoryNodes(ctx, q)
	if len(nodes) != 1 || nodes[0].ID != "parent" {
		t.Fatal(nodes)
	}
	if err := s.ReconcileHistoryMemories(ctx, chat.ID, map[string]string{"m1": "v2"}); err != nil {
		t.Fatal(err)
	}
	nodes, _ = s.ReadHistoryNodes(ctx, q)
	if len(nodes) != 1 || nodes[0].ID != right.ID {
		t.Fatal("unrelated section was lost", nodes)
	}
	q.Uncovered = true
	page, err := s.ReadHistory(ctx, q)
	if err != nil || len(page.Turns) != 1 || page.Turns[0].ID != "dialogue:"+a.ID {
		t.Fatal(page, err)
	}
	// Rebuilding the leaf and its parent must not touch the unrelated leaf.
	left = makeLeaf(left.ID, a, "")
	nodes, _ = s.ReadHistoryNodes(ctx, q)
	if len(nodes) != 2 {
		t.Fatal(nodes)
	}
	for _, n := range nodes {
		if n.ID == right.ID && n.Text != "right summary" {
			t.Fatal(n)
		}
	}
	// External deletion is discovered by the rotating stat audit and invalidates its section.
	if err := os.Remove(filepath.Join(s.root, chat.ID, "dialogue", dialogueFilename(b))); err != nil {
		t.Fatal(err)
	}
	if err := s.AuditHistory(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	nodes, _ = s.ReadHistoryNodes(ctx, q)
	if len(nodes) != 1 || nodes[0].ID != left.ID {
		t.Fatal(nodes)
	}
}

func TestHistorySummaryCannotCrossAdmissionBoundary(t *testing.T) {
	ctx := context.Background()
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	at := time.Now().Add(-time.Hour)
	turn, err := s.AdmitDialogue(chat.ID, "boundary-history-message-001", "Prior input", json.RawMessage(`{}`), at)
	if err != nil {
		t.Fatal(err)
	}
	_, digest, err := s.ReadHistoryTurn(ctx, chat.ID, "dialogue:"+turn.ID)
	if err != nil {
		t.Fatal(err)
	}
	n := HistoryNode{ID: "leaf", Chat: chat.ID, Text: "Earlier section", Dependencies: []HistoryDependency{{Kind: "source", Key: "dialogue:" + turn.ID, Digest: digest}}}
	if err := s.SaveHistoryNode(ctx, n); err != nil {
		t.Fatal(err)
	}
	nodes, err := s.ReadHistoryNodes(ctx, HistoryQuery{Chat: chat.ID, Before: turn.Sequence, At: at})
	if err != nil || len(nodes) != 0 {
		t.Fatal("summary leaked excluded source", nodes, err)
	}
	// Invalid source digests cannot be published even if text generation succeeded.
	n.ID = "stale"
	n.Dependencies[0].Digest = "wrong"
	if err := s.SaveHistoryNode(ctx, n); err == nil {
		t.Fatal("published stale summary")
	}
	// Marking a parent blocked exposes still-clean, separately screened children.
	_ = s.HistoryCache(ctx, func(db *sql.DB) error {
		_, err := db.ExecContext(ctx, `UPDATE history_nodes SET dirty=1 WHERE id='leaf'`)
		return err
	})
}
