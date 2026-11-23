package worksession

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
)

// InvalidateHistoryMemory is a cache-only notification from the memory owner.
// Canonical memory, withdrawal rules and candidate screening remain authoritative
// if a notification is interrupted or this disposable database is unavailable.
func (s Store) InvalidateHistoryMemory(ctx context.Context, id string) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT chat FROM history_dependencies WHERE kind='memory' AND key=?`, id)
		if err != nil {
			return err
		}
		var chats []string
		for rows.Next() {
			var chat string
			if err := rows.Scan(&chat); err != nil {
				rows.Close()
				return err
			}
			chats = append(chats, chat)
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
		for _, chat := range chats {
			if err := invalidateHistory(ctx, tx, chat, "memory", id); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM semantic_vectors WHERE id IN(SELECT c.id FROM history_chunks c JOIN history_dependencies src ON src.chat=c.chat AND src.kind='source' AND src.key=c.key JOIN history_dependencies m ON m.chat=src.chat AND m.node=src.node AND m.kind='memory' WHERE m.key=?)`, id)
		if err != nil {
			return err
		}
		return tx.Commit()
	})
}

// Suppressed source identities are hash-only. Match indexed chat identities to
// those hashes without expanding provenance records or retaining forgotten text.
func (s Store) InvalidateHistoryOrigins(ctx context.Context, goal string, hashes map[string]bool) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT chat FROM history_sources`)
		if err != nil {
			return err
		}
		var chats []string
		for rows.Next() {
			var chat string
			if err := rows.Scan(&chat); err != nil {
				rows.Close()
				return err
			}
			sum := sha256.Sum256([]byte(goal + "\n" + chat))
			if hashes[hex.EncodeToString(sum[:])] {
				chats = append(chats, chat)
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
		for _, chat := range chats {
			if _, err := tx.ExecContext(ctx, `DELETE FROM semantic_vectors WHERE id IN(SELECT id FROM history_chunks WHERE chat=?)`, chat); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}
