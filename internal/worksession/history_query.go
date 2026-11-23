package worksession

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type HistoryQuery struct {
	Chat      string
	Before    uint64
	At        time.Time
	Limit     int
	Uncovered bool
	Tasks     bool
}
type HistoryPage struct {
	Turns      []ContextTurn
	Total      int
	Incomplete bool
}

func historyBounds(q HistoryQuery) (int64, uint64) {
	at := int64(math.MaxInt64)
	if !q.At.IsZero() {
		at = q.At.UnixNano()
	}
	before := q.Before
	if before == 0 {
		before = math.MaxInt64
	}
	return at, before
}

const historyScopeSQL = `WITH RECURSIVE ancestry(key) AS (SELECT 'work:'||? WHERE ?<>'' UNION SELECT 'work:'||s.parent FROM history_sources s JOIN ancestry a ON s.key=a.key WHERE s.chat=? AND s.parent<>''), selected AS (SELECT s.* FROM history_sources s WHERE s.chat=? AND ((s.seq>0 AND s.seq<? AND s.at<=?) OR(s.seq=0 AND s.key IN(SELECT key FROM ancestry) AND s.at<?))) `

// ReadHistory is a bounded, canonical-checked window over the complete index.
// Its result does not depend on a conversation's total length or byte size.
func (s Store) ReadHistory(ctx context.Context, q HistoryQuery) (HistoryPage, error) {
	var result HistoryPage
	if q.Limit < 1 || q.Limit > 128 {
		return result, errors.New("invalid indexed history page")
	}
	c, err := s.Load(q.Chat)
	if err != nil {
		return result, err
	}
	at, before := historyBounds(q)
	var raw []ContextTurn
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		args := []any{c.HeadRevision, c.HeadRevision, q.Chat, q.Chat, before, at, at}
		if err := db.QueryRowContext(ctx, historyScopeSQL+`SELECT count(*) FROM selected`, args...).Scan(&result.Total); err != nil {
			return err
		}
		where, order := "", ` ORDER BY at DESC,seq DESC,key DESC`
		if q.Uncovered {
			where = ` WHERE NOT EXISTS(SELECT 1 FROM history_dependencies d JOIN history_nodes n ON n.chat=d.chat AND n.id=d.node WHERE d.chat=selected.chat AND d.kind='source' AND d.key=selected.key AND d.digest=selected.digest AND n.level=0 AND n.dirty=0 AND n.maxseq<? AND n.source_updated<=? AND(n.anchor='' OR 'work:'||n.anchor IN(SELECT key FROM ancestry)))`
			args = append(args, before, at)
			order = ` ORDER BY at,seq,key`
		}
		if q.Tasks {
			where = ` WHERE json_extract(body,'$.task_chat') IS NOT NULL AND json_extract(body,'$.task_chat')<>''`
		}
		rows, err := db.QueryContext(ctx, historyScopeSQL+`SELECT body,updated FROM selected`+where+order+` LIMIT ?`, append(args, q.Limit)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var data string
			var updated int64
			var t ContextTurn
			if err := rows.Scan(&data, &updated); err != nil {
				return err
			}
			if err := json.Unmarshal([]byte(data), &t); err != nil {
				return err
			}
			raw = append(raw, t)
		}
		return rows.Err()
	})
	if err != nil {
		return result, err
	}
	for _, candidate := range raw {
		t, _, err := s.ReadHistoryTurn(ctx, q.Chat, candidate.ID)
		if err != nil {
			result.Incomplete = true
			continue
		}
		if t.Sequence > 0 && t.Sequence >= before || t.At.UnixNano() > at || t.Sequence == 0 && t.At.UnixNano() == at {
			continue
		}
		if !q.At.IsZero() && t.Sequence > 0 {
			turn, err := s.ReadDialogue(q.Chat, strings.TrimPrefix(t.ID, "dialogue:"))
			if err != nil {
				result.Incomplete = true
				continue
			}
			if turn.UpdatedAt.After(q.At) {
				t.Assistant, t.State, t.TaskChat = "", "unconfirmed_at_admission", ""
			}
		}
		result.Turns = append(result.Turns, t)
	}
	if !q.Uncovered {
		for i, j := 0, len(result.Turns)-1; i < j; i, j = i+1, j-1 {
			result.Turns[i], result.Turns[j] = result.Turns[j], result.Turns[i]
		}
	}
	return result, nil
}

func (s Store) HistoryIsPast(ctx context.Context, q HistoryQuery) (bool, error) {
	if q.Before == 0 || q.At.IsZero() {
		return false, nil
	}
	var past bool
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		return db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM history_sources WHERE chat=? AND(seq>? OR(seq=0 AND at>?)))`, q.Chat, q.Before, q.At.UnixNano()).Scan(&past)
	})
	return past, err
}

func (s Store) ReadHistoryTurn(ctx context.Context, chat, key string) (ContextTurn, string, error) {
	if _, err := s.Load(chat); err != nil {
		return ContextTurn{}, "", err
	}
	kind, id, ok := strings.Cut(key, ":")
	if !ok {
		return ContextTurn{}, "", errors.New("invalid public history key")
	}
	var t ContextTurn
	var path, parent string
	var updated time.Time
	switch kind {
	case "dialogue":
		if len(id) != 64 {
			return t, "", errors.New("invalid dialogue history key")
		}
		r, err := s.ReadDialogue(chat, id)
		if err != nil {
			return t, "", s.dropMissingHistory(ctx, chat, key, err)
		}
		t = ContextTurn{ID: key, Sequence: r.Sequence, User: r.Text, Assistant: r.Response, State: r.State, TaskChat: r.TaskChat, At: r.CreatedAt}
		path = filepath.Join(chat, "dialogue", dialogueFilename(r))
		updated = r.UpdatedAt
	case "work":
		r, err := s.LoadRevision(chat, id)
		if err != nil {
			return t, "", s.dropMissingHistory(ctx, chat, key, err)
		}
		t = ContextTurn{ID: key, User: r.Objective, Assistant: r.FinalText, State: r.Status, At: r.CreatedAt}
		path = filepath.Join(chat, "revisions", id+".json")
		parent = r.ParentRevisionID
		updated = r.CreatedAt
	default:
		return t, "", errors.New("unknown public history kind")
	}
	if err := s.indexContextTurn(ctx, t, parent, path, updated); err != nil {
		return t, "", err
	}
	return t, ContextDigest([]ContextTurn{t}), nil
}

func (s Store) dropMissingHistory(ctx context.Context, chat, key string, cause error) error {
	if !errors.Is(cause, os.ErrNotExist) {
		return cause
	}
	_ = s.HistoryCache(ctx, func(db *sql.DB) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err = invalidateHistory(ctx, tx, chat, "source", key); err != nil {
			return err
		}
		for _, statement := range []string{`DELETE FROM semantic_vectors WHERE id IN(SELECT id FROM history_chunks WHERE chat=? AND key=?)`, `DELETE FROM history_fts WHERE id IN(SELECT id FROM history_chunks WHERE chat=? AND key=?)`, `DELETE FROM history_chunks WHERE chat=? AND key=?`, `DELETE FROM history_sources WHERE chat=? AND key=?`} {
			if _, err = tx.ExecContext(ctx, statement, chat, key); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
	return cause
}

type HistoryMatch struct {
	ID, Chat, Key, Text, Digest string
	Part                        int
	Score                       float64
}

// SearchHistory searches all indexed chats, using bound FTS expressions. Owning
// scope/privacy checks and canonical rereads remain mandatory before disclosure.
func (s Store) SearchHistory(ctx context.Context, words []string, limit int) ([]HistoryMatch, error) {
	if len(words) == 0 || len(words) > 24 || limit < 1 || limit > 128 {
		return nil, errors.New("invalid history search")
	}
	var quoted []string
	for _, word := range words {
		quoted = append(quoted, `"`+strings.ReplaceAll(word, `"`, `""`)+`"`)
	}
	var result []HistoryMatch
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT c.id,c.chat,c.key,c.part,c.text,c.digest,bm25(history_fts) FROM history_fts JOIN history_chunks c ON c.id=history_fts.id WHERE history_fts MATCH ? ORDER BY bm25(history_fts),c.id LIMIT ?`, strings.Join(quoted, " OR "), limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m HistoryMatch
			if err := rows.Scan(&m.ID, &m.Chat, &m.Key, &m.Part, &m.Text, &m.Digest, &m.Score); err != nil {
				return err
			}
			result = append(result, m)
		}
		return rows.Err()
	})
	return result, err
}

func (s Store) ReadHistoryMatch(ctx context.Context, m HistoryMatch) (ContextTurn, error) {
	t, digest, err := s.ReadHistoryTurn(ctx, m.Chat, m.Key)
	if err != nil {
		return t, err
	}
	if digest != m.Digest {
		return t, errors.New("indexed history changed; candidate was not returned")
	}
	text := []rune(t.User + "\n" + t.Assistant)
	start := m.Part * 1200
	if start < 0 || start >= len(text) {
		return t, errors.New("invalid history chunk boundary")
	}
	m.Text = string(text[start:min(start+1500, len(text))])
	t.User = m.Text
	t.Assistant = ""
	return t, nil
}
