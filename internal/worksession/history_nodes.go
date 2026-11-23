package worksession

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type HistoryDependency struct{ Kind, Key, Digest string }
type HistoryNode struct {
	ID, Chat, Text, Digest, Policy, Anchor string
	Level, Covered                         int
	FirstAt, LastAt, SourceUpdated         int64
	MaxSequence                            uint64
	Dependencies                           []HistoryDependency
}

// ReconcileHistoryMemories invalidates only nodes which actually depended on a
// changed/deleted memory, plus their ancestors. Unrelated edits keep summaries.
func (s Store) ReconcileHistoryMemories(ctx context.Context, chat string, versions map[string]string) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT chat,key,digest FROM history_dependencies WHERE kind='memory' AND chat=?`, chat)
		if err != nil {
			return err
		}
		type dep struct{ chat, key, digest string }
		var changed []dep
		for rows.Next() {
			var d dep
			if err := rows.Scan(&d.chat, &d.key, &d.digest); err != nil {
				rows.Close()
				return err
			}
			actual := versions[d.key]
			if actual == "" {
				actual = "missing"
			}
			if actual != d.digest {
				changed = append(changed, d)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, d := range changed {
			if err := invalidateHistory(ctx, tx, d.chat, "memory", d.key); err != nil {
				return err
			}
			// Vectors of directly affected source sections also become disposable.
			if _, err := tx.ExecContext(ctx, `DELETE FROM semantic_vectors WHERE id IN(SELECT c.id FROM history_chunks c JOIN history_dependencies src ON src.chat=c.chat AND src.kind='source' AND src.key=c.key JOIN history_dependencies m ON m.chat=src.chat AND m.node=src.node AND m.kind='memory' WHERE m.chat=? AND m.key=?)`, d.chat, d.key); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

func (s Store) HistoryMemoryDependencies(ctx context.Context, chat, key string) ([]string, error) {
	var ids []string
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT m.key FROM history_dependencies a JOIN history_dependencies m ON m.chat=a.chat AND m.node=a.node AND m.kind='memory' WHERE a.chat=? AND a.kind='source' AND a.key=?`, chat, key)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}

func (s Store) ReadHistoryNodes(ctx context.Context, q HistoryQuery) ([]HistoryNode, error) {
	c, err := s.Load(q.Chat)
	if err != nil {
		return nil, err
	}
	at, before := historyBounds(q)
	var nodes []HistoryNode
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		query := historyScopeSQL + `, eligible AS (SELECT n.* FROM history_nodes n WHERE n.chat=? AND n.dirty=0 AND n.maxseq<? AND n.source_updated<=? AND(n.anchor='' OR 'work:'||n.anchor IN(SELECT key FROM ancestry))) SELECT n.id,n.level,n.first_at,n.last_at,n.text,n.digest,n.policy,n.anchor,n.maxseq,n.source_updated,n.covered FROM eligible n WHERE NOT EXISTS(SELECT 1 FROM history_dependencies d JOIN eligible p ON p.id=d.node WHERE d.chat=? AND d.kind='node' AND d.key=n.id) ORDER BY n.first_at,n.id LIMIT 64`
		rows, err := db.QueryContext(ctx, query, c.HeadRevision, c.HeadRevision, q.Chat, q.Chat, before, at, at, q.Chat, before, at, q.Chat)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var n HistoryNode
			n.Chat = q.Chat
			if err := rows.Scan(&n.ID, &n.Level, &n.FirstAt, &n.LastAt, &n.Text, &n.Digest, &n.Policy, &n.Anchor, &n.MaxSequence, &n.SourceUpdated, &n.Covered); err != nil {
				return err
			}
			nodes = append(nodes, n)
		}
		return rows.Err()
	})
	return nodes, err
}

func (s Store) SaveHistoryNode(ctx context.Context, n HistoryNode) error {
	if n.ID == "" || len(n.ID) > 128 || n.Level < 0 || n.Level > 64 || len(n.Text) > 12*1024 || strings.TrimSpace(n.Text) == "" || len(n.Dependencies) == 0 || len(n.Dependencies) > 128 {
		return errors.New("invalid history summary node")
	}
	c, err := s.Load(n.Chat)
	if err != nil {
		return err
	}
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var dirty int
		err = tx.QueryRowContext(ctx, `SELECT dirty FROM history_nodes WHERE chat=? AND id=?`, n.Chat, n.ID).Scan(&dirty)
		if err == nil && dirty == 0 {
			return nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var anchors []string
		for _, d := range n.Dependencies {
			switch d.Kind {
			case "source":
				var digest, key, parent string
				var at, updated int64
				var seq uint64
				if err := tx.QueryRowContext(ctx, `SELECT digest,key,parent,at,updated,seq FROM history_sources WHERE chat=? AND key=?`, n.Chat, d.Key).Scan(&digest, &key, &parent, &at, &updated, &seq); err != nil {
					return err
				}
				if digest != d.Digest {
					return errors.New("summary source changed during preparation")
				}
				if n.FirstAt == 0 || at < n.FirstAt {
					n.FirstAt = at
				}
				if at > n.LastAt {
					n.LastAt = at
				}
				if updated > n.SourceUpdated {
					n.SourceUpdated = updated
				}
				if seq > n.MaxSequence {
					n.MaxSequence = seq
				}
				n.Covered++
				if strings.HasPrefix(key, "work:") {
					anchors = append(anchors, strings.TrimPrefix(key, "work:"))
				}
			case "node":
				var child HistoryNode
				var childDirty int
				if err := tx.QueryRowContext(ctx, `SELECT digest,dirty,first_at,last_at,anchor,maxseq,source_updated,covered FROM history_nodes WHERE chat=? AND id=?`, n.Chat, d.Key).Scan(&child.Digest, &childDirty, &child.FirstAt, &child.LastAt, &child.Anchor, &child.MaxSequence, &child.SourceUpdated, &child.Covered); err != nil {
					return err
				}
				if child.Digest != d.Digest || childDirty != 0 {
					return errors.New("child summary changed during preparation")
				}
				if n.FirstAt == 0 || child.FirstAt < n.FirstAt {
					n.FirstAt = child.FirstAt
				}
				if child.LastAt > n.LastAt {
					n.LastAt = child.LastAt
				}
				if child.SourceUpdated > n.SourceUpdated {
					n.SourceUpdated = child.SourceUpdated
				}
				if child.MaxSequence > n.MaxSequence {
					n.MaxSequence = child.MaxSequence
				}
				n.Covered += child.Covered
				if child.Anchor != "" {
					anchors = append(anchors, child.Anchor)
				}
			case "memory":
			default:
				return errors.New("unknown history dependency kind")
			}
		}
		if len(anchors) > 0 {
			var placeholders []string
			args := []any{c.HeadRevision, n.Chat}
			for _, anchor := range anchors {
				placeholders = append(placeholders, "?")
				args = append(args, anchor)
			}
			query := `WITH RECURSIVE a(id,depth) AS(SELECT ?,0 UNION ALL SELECT s.parent,a.depth+1 FROM history_sources s JOIN a ON s.key='work:'||a.id WHERE s.chat=? AND s.parent<>'' AND a.depth<100000) SELECT id FROM a WHERE id IN(` + strings.Join(placeholders, ",") + `) ORDER BY depth LIMIT 1`
			if err := tx.QueryRowContext(ctx, query, args...).Scan(&n.Anchor); err != nil {
				return errors.New("summary work ancestry changed")
			}
		}
		data, _ := json.Marshal(struct {
			Text string
			Deps []HistoryDependency
		}{n.Text, n.Dependencies})
		n.Digest = ContextDigest([]ContextTurn{{User: string(data)}})
		if _, err := tx.ExecContext(ctx, `INSERT INTO history_nodes(chat,id,level,first_at,last_at,text,digest,dirty,policy,anchor,maxseq,source_updated,covered,created_at) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?) ON CONFLICT(chat,id) DO UPDATE SET text=excluded.text,digest=excluded.digest,dirty=0,policy=excluded.policy,anchor=excluded.anchor,maxseq=excluded.maxseq,source_updated=excluded.source_updated,covered=excluded.covered,created_at=excluded.created_at`, n.Chat, n.ID, n.Level, n.FirstAt, n.LastAt, n.Text, n.Digest, n.Policy, n.Anchor, n.MaxSequence, n.SourceUpdated, n.Covered, time.Now().UnixNano()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM history_dependencies WHERE chat=? AND node=?`, n.Chat, n.ID); err != nil {
			return err
		}
		for _, d := range n.Dependencies {
			if _, err := tx.ExecContext(ctx, `INSERT INTO history_dependencies VALUES(?,?,?,?,?)`, n.Chat, n.ID, d.Kind, d.Key, d.Digest); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

func (s Store) SetHistoryNodePolicy(ctx context.Context, n HistoryNode, policy string, blocked bool) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		if !blocked {
			_, err := db.ExecContext(ctx, `UPDATE history_nodes SET policy=? WHERE chat=? AND id=? AND digest=? AND dirty=0`, policy, n.Chat, n.ID, n.Digest)
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := invalidateHistory(ctx, tx, n.Chat, "node", n.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE history_nodes SET dirty=1,text='' WHERE chat=? AND id=? AND digest=?`, n.Chat, n.ID, n.Digest); err != nil {
			return err
		}
		// Remove embeddings for affected source sections; canonical text remains.
		if _, err := tx.ExecContext(ctx, `WITH RECURSIVE children(id) AS(SELECT ? UNION SELECT d.key FROM history_dependencies d JOIN children c ON d.node=c.id WHERE d.chat=? AND d.kind='node') DELETE FROM semantic_vectors WHERE id IN(SELECT c.id FROM history_chunks c JOIN history_dependencies d ON d.chat=c.chat AND d.kind='source' AND d.key=c.key WHERE d.chat=? AND d.node IN(SELECT id FROM children))`, n.ID, n.Chat, n.Chat); err != nil {
			return err
		}
		return tx.Commit()
	})
}

func HistoryNodeID(kind string, parts ...string) string {
	return fmt.Sprintf("%s-%s", kind, ContextDigest([]ContextTurn{{User: strings.Join(parts, "\x00")}}))
}
