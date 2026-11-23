package worksession

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
)

// AuditHistory checks a rotating page of source metadata. Native mutations update
// immediately; this also repairs edits/deletions made outside the runtime.
func (s Store) AuditHistory(ctx context.Context, chat string) error {
	type source struct {
		key, path   string
		size, mtime int64
	}
	var page []source
	var after string
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		err := db.QueryRowContext(ctx, `SELECT value FROM history_meta WHERE key=?`, "audit:"+chat).Scan(&after)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		rows, err := db.QueryContext(ctx, `SELECT key,path,size,mtime FROM history_sources WHERE chat=? AND key>? ORDER BY key LIMIT 32`, chat, after)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r source
			if err := rows.Scan(&r.key, &r.path, &r.size, &r.mtime); err != nil {
				return err
			}
			page = append(page, r)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	for _, r := range page {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := os.Lstat(filepath.Join(s.root, r.path))
		if err != nil || !info.Mode().IsRegular() || info.Size() != r.size || info.ModTime().UnixNano() != r.mtime {
			if _, _, err = s.ReadHistoryTurn(ctx, chat, r.key); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		after = r.key
	}
	if len(page) < 32 {
		after = ""
	}
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		_, err := db.ExecContext(ctx, `INSERT INTO history_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "audit:"+chat, after)
		return err
	})
}

// HistoryMatchEligible binds a candidate to the current canonical branch and
// admission boundary. A cached search result never grants access by itself.
func (s Store) HistoryMatchEligible(ctx context.Context, q HistoryQuery, m HistoryMatch) (bool, error) {
	c, err := s.Load(q.Chat)
	if err != nil {
		return false, err
	}
	at, before := historyBounds(q)
	var eligible bool
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		return db.QueryRowContext(ctx, historyScopeSQL+`SELECT EXISTS(SELECT 1 FROM selected WHERE key=? AND digest=? AND updated<=?)`, c.HeadRevision, c.HeadRevision, q.Chat, q.Chat, before, at, at, m.Key, m.Digest, at).Scan(&eligible)
	})
	return eligible, err
}
