package worksession

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// HistoryCache shares the existing private, replaceable SQLite infrastructure.
// Callers cannot choose a database path. JSON remains the authoritative source.
func (s Store) HistoryCache(ctx context.Context, fn func(*sql.DB) error) error {
	db, close, err := s.openCatalogIndex(ctx)
	if err != nil {
		return err
	}
	defer close()
	for _, statement := range []string{
		`CREATE TABLE IF NOT EXISTS history_sources(chat TEXT NOT NULL,key TEXT NOT NULL,parent TEXT NOT NULL DEFAULT '',seq INTEGER NOT NULL,at INTEGER NOT NULL,updated INTEGER NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,mtime INTEGER NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(chat,key))`,
		`CREATE INDEX IF NOT EXISTS history_order ON history_sources(chat,at,seq,key)`,
		`CREATE TABLE IF NOT EXISTS history_chunks(id TEXT PRIMARY KEY,chat TEXT NOT NULL,key TEXT NOT NULL,part INTEGER NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS history_chunk_source ON history_chunks(chat,key)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(id UNINDEXED,text,tokenize='unicode61')`,
		`CREATE TABLE IF NOT EXISTS history_progress(chat TEXT PRIMARY KEY,oldest INTEGER NOT NULL DEFAULT 0,dialogue_done INTEGER NOT NULL DEFAULT 0,head TEXT NOT NULL DEFAULT '',work_cursor TEXT NOT NULL DEFAULT '',work_done INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE IF NOT EXISTS history_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS history_maintenance(chat TEXT PRIMARY KEY,key TEXT NOT NULL,payload TEXT NOT NULL,generation INTEGER NOT NULL,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL,lease TEXT NOT NULL,lease_until INTEGER NOT NULL,updated INTEGER NOT NULL,last_error TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS history_nodes(chat TEXT NOT NULL,id TEXT NOT NULL,level INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 0,policy TEXT NOT NULL,anchor TEXT NOT NULL DEFAULT '',maxseq INTEGER NOT NULL DEFAULT 0,source_updated INTEGER NOT NULL DEFAULT 0,covered INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(chat,id))`,
		`CREATE TABLE IF NOT EXISTS history_dependencies(chat TEXT NOT NULL,node TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(chat,node,kind,key))`,
		`CREATE INDEX IF NOT EXISTS history_dependency_source ON history_dependencies(chat,kind,key)`,
		`CREATE TABLE IF NOT EXISTS semantic_vectors(provider TEXT NOT NULL,scope TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(provider,scope,id))`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return fn(db)
}

func invalidateHistory(ctx context.Context, tx *sql.Tx, chat, kind, key string) error {
	_, err := tx.ExecContext(ctx, `WITH RECURSIVE affected(id) AS (SELECT node FROM history_dependencies WHERE chat=? AND kind=? AND key=? UNION SELECT d.node FROM history_dependencies d JOIN affected a ON d.kind='node' AND d.key=a.id WHERE d.chat=?) UPDATE history_nodes SET dirty=1,text='' WHERE chat=? AND id IN(SELECT id FROM affected)`, chat, kind, key, chat, chat)
	return err
}

func (s Store) indexContextTurn(ctx context.Context, t ContextTurn, parent, path string, updated time.Time) error {
	info, err := os.Lstat(filepath.Join(s.root, path))
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("history source must be regular")
	}
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		return putHistorySource(ctx, db, t, parent, path, updated, info)
	})
}

func putHistorySource(ctx context.Context, db *sql.DB, t ContextTurn, parent, path string, updated time.Time, info os.FileInfo) error {
	chat := strings.Split(filepath.ToSlash(path), "/")[0]
	digest := ContextDigest([]ContextTurn{t})
	var old string
	var oldUpdated int64
	err := db.QueryRowContext(ctx, `SELECT digest,updated FROM history_sources WHERE chat=? AND key=?`, chat, t.ID).Scan(&old, &oldUpdated)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if oldUpdated > updated.UnixNano() {
		return nil
	}
	if old == digest {
		_, err = db.ExecContext(ctx, `UPDATE history_sources SET size=?,mtime=? WHERE chat=? AND key=?`, info.Size(), info.ModTime().UnixNano(), chat, t.ID)
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = invalidateHistory(ctx, tx, chat, "source", t.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM semantic_vectors WHERE id IN(SELECT id FROM history_chunks WHERE chat=? AND key=?)`, chat, t.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM history_fts WHERE id IN(SELECT id FROM history_chunks WHERE chat=? AND key=?)`, chat, t.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM history_chunks WHERE chat=? AND key=?`, chat, t.ID); err != nil {
		return err
	}
	data, err := json.Marshal(t)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO history_sources VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat,key) DO UPDATE SET parent=excluded.parent,seq=excluded.seq,at=excluded.at,updated=excluded.updated,path=excluded.path,size=excluded.size,mtime=excluded.mtime,digest=excluded.digest,body=excluded.body`, chat, t.ID, parent, t.Sequence, t.At.UnixNano(), updated.UnixNano(), filepath.ToSlash(path), info.Size(), info.ModTime().UnixNano(), digest, string(data)); err != nil {
		return err
	}
	text := []rune(t.User + "\n" + t.Assistant)
	for part, start := 0, 0; start < len(text); part, start = part+1, start+1200 {
		end := min(start+1500, len(text))
		body := string(text[start:end])
		id := ContextDigest([]ContextTurn{{ID: chat + ":" + t.ID, User: fmt.Sprint(part)}})
		if _, err = tx.ExecContext(ctx, `INSERT INTO history_chunks VALUES(?,?,?,?,?,?)`, id, chat, t.ID, part, body, digest); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO history_fts(id,text) VALUES(?,?)`, id, body); err != nil {
			return err
		}
		if end == len(text) {
			break
		}
	}
	return tx.Commit()
}

func (s Store) indexDialogue(t DialogueTurn) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s.historyHookResult(t.ConversationID, "dialogue:"+t.ID, s.putDialogueContext(ctx, t))
}
func (s Store) putDialogueContext(ctx context.Context, t DialogueTurn) error {
	return s.indexContextTurn(ctx, ContextTurn{ID: "dialogue:" + t.ID, Sequence: t.Sequence, User: t.Text, Assistant: t.Response, State: t.State, TaskChat: t.TaskChat, At: t.CreatedAt}, "", filepath.Join(t.ConversationID, "dialogue", dialogueFilename(t)), t.UpdatedAt)
}
func (s Store) indexRevision(chat string, r Revision) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s.historyHookResult(chat, "work:"+r.ID, s.putRevisionContext(ctx, chat, r))
}
func (s Store) putRevisionContext(ctx context.Context, chat string, r Revision) error {
	return s.indexContextTurn(ctx, ContextTurn{ID: "work:" + r.ID, User: r.Objective, Assistant: r.FinalText, State: r.Status, At: r.CreatedAt}, r.ParentRevisionID, filepath.Join(chat, "revisions", r.ID+".json"), r.CreatedAt)
}

func (s Store) putDialoguePage(ctx context.Context, turns []DialogueTurn) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		for _, t := range turns {
			path := filepath.Join(t.ConversationID, "dialogue", dialogueFilename(t))
			info, err := os.Lstat(filepath.Join(s.root, path))
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() {
				return errors.New("history source must be regular")
			}
			if err := putHistorySource(ctx, db, ContextTurn{ID: "dialogue:" + t.ID, Sequence: t.Sequence, User: t.Text, Assistant: t.Response, State: t.State, TaskChat: t.TaskChat, At: t.CreatedAt}, "", path, t.UpdatedAt, info); err != nil {
				return err
			}
		}
		return nil
	})
}

// SyncHistory backfills one bounded page. New native writes are indexed directly;
// a lost/corrupt cache resumes backfill while recent messages remain available.
func (s Store) SyncHistory(ctx context.Context, chat string, limit int) (bool, error) {
	if limit < 16 || limit > 256 {
		return false, errors.New("invalid history indexing batch")
	}
	lock, err := s.requestLock(chat, ".history-sync.lock", true)
	if errors.Is(err, filelock.ErrWouldBlock) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	defer lock.Close()
	c, err := s.Load(chat)
	if err != nil {
		return false, err
	}
	if err := s.repairHistory(ctx, chat); err != nil {
		return true, err
	}
	var oldest uint64
	var done, workDone int
	var head, cursor string
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		err := db.QueryRowContext(ctx, `SELECT oldest,dialogue_done,head,work_cursor,work_done FROM history_progress WHERE chat=?`, chat).Scan(&oldest, &done, &head, &cursor, &workDone)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		return false, err
	}
	latest, _, err := s.DialoguePage(chat, 0, 8)
	if err != nil {
		return false, err
	}
	if err := s.putDialoguePage(ctx, latest); err != nil {
		return false, err
	}
	if oldest == 0 && len(latest) > 0 {
		oldest = latest[0].Sequence
	}
	if done == 0 {
		for budget := limit - 8; budget > 0 && done == 0; {
			page, more, err := s.DialoguePage(chat, oldest, min(100, budget))
			if err != nil {
				return false, err
			}
			if err := s.putDialoguePage(ctx, page); err != nil {
				return false, err
			}
			budget -= len(page)
			if len(page) > 0 {
				oldest = page[0].Sequence
			}
			if !more || len(page) == 0 {
				done = 1
			}
		}
	}
	if head != c.HeadRevision {
		head, cursor, workDone = c.HeadRevision, c.HeadRevision, 0
	}
	seen := map[string]bool{}
	for n := 0; cursor != "" && n < limit; n++ {
		if seen[cursor] {
			return false, errors.New("history ancestry cycle")
		}
		seen[cursor] = true
		r, err := s.LoadRevision(chat, cursor)
		if err != nil {
			return false, err
		}
		if err := s.putRevisionContext(ctx, chat, r); err != nil {
			return false, err
		}
		cursor = r.ParentRevisionID
	}
	if cursor == "" {
		workDone = 1
	}
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		_, err := db.ExecContext(ctx, `INSERT INTO history_progress VALUES(?,?,?,?,?,?) ON CONFLICT(chat) DO UPDATE SET oldest=excluded.oldest,dialogue_done=excluded.dialogue_done,head=excluded.head,work_cursor=excluded.work_cursor,work_done=excluded.work_done`, chat, oldest, done, head, cursor, workDone)
		return err
	})
	if err == nil {
		err = s.AuditHistory(ctx, chat)
	}
	return done == 0 || workDone == 0, err
}

// SweepHistory advances discovery independently of chat recency. It never starts
// inference or changes canonical history. Cursor state survives host restarts.
func (s Store) SweepHistory(ctx context.Context) error {
	release, err := state.Guard(filepath.Dir(filepath.Dir(s.root)), false)
	if err != nil {
		return err
	}
	defer release()
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	var ids []string
	for _, entry := range entries {
		if entry.IsDir() && validID(entry.Name()) == nil {
			ids = append(ids, entry.Name())
		}
	}
	sort.Strings(ids)
	var after string
	if err := s.HistoryCache(ctx, func(db *sql.DB) error {
		err := db.QueryRowContext(ctx, `SELECT value FROM history_meta WHERE key='discovery'`).Scan(&after)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}); err != nil {
		return err
	}
	start := sort.SearchStrings(ids, after)
	if start < len(ids) && ids[start] == after {
		start++
	}
	if start == len(ids) {
		start = 0
	}
	var failures error
	for n := 0; n < min(4, len(ids)); n++ {
		id := ids[(start+n)%len(ids)]
		if _, err := s.SyncHistory(ctx, id, 32); err != nil {
			failures = errors.Join(failures, err)
		}
		// Persist discovery after each visit, including an unreadable chat. One bad
		// source must not starve other archives, and cancellation retains progress.
		if err := s.HistoryCache(ctx, func(db *sql.DB) error {
			_, err := db.ExecContext(ctx, `INSERT INTO history_meta VALUES('discovery',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, id)
			return err
		}); err != nil {
			return errors.Join(failures, err)
		}
	}
	return failures
}
