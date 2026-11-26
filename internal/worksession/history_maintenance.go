package worksession

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

// HistoryMaintenance is a private, disposable request, not execution authority.
// Claims survive crashes for at most two minutes; publication rechecks sources.
type HistoryMaintenance struct {
	Chat, Key, Lease     string
	Generation, Attempts int
	Payload              json.RawMessage
}

func (s Store) QueueHistoryMaintenance(ctx context.Context, chat, key string, payload json.RawMessage, now time.Time) error {
	if validID(chat) != nil || len(key) != 64 || len(payload) > 64*1024 || !json.Valid(payload) {
		return errors.New("invalid summary maintenance request")
	}
	if _, err := s.Load(chat); err != nil {
		return err
	}
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		var count int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM history_maintenance`).Scan(&count); err != nil {
			return err
		}
		if count >= 512 {
			var exists int
			if err := db.QueryRowContext(ctx, `SELECT count(*) FROM history_maintenance WHERE chat=?`, chat).Scan(&exists); err != nil {
				return err
			}
			if exists == 0 {
				return errors.New("summary maintenance queue is full")
			}
		}
		_, err := db.ExecContext(ctx, `INSERT INTO history_maintenance(chat,key,payload,generation,attempts,next_at,lease,lease_until,updated,last_error) VALUES(?,?,?,1,0,?,'',0,?,'') ON CONFLICT(chat) DO UPDATE SET payload=excluded.payload,generation=history_maintenance.generation+1,attempts=CASE WHEN key=excluded.key THEN attempts ELSE 0 END,next_at=CASE WHEN key=excluded.key THEN next_at ELSE excluded.next_at END,last_error=CASE WHEN key=excluded.key THEN last_error ELSE '' END,key=excluded.key,updated=excluded.updated`, chat, key, string(payload), now.UnixNano(), now.UnixNano())
		return err
	})
}
func (s Store) ClaimHistoryMaintenance(ctx context.Context, now time.Time) (HistoryMaintenance, bool, error) {
	var job HistoryMaintenance
	found := false
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		var payload string
		err := db.QueryRowContext(ctx, `SELECT chat,key,payload,generation,attempts FROM history_maintenance WHERE next_at<=? AND lease_until<=? AND NOT EXISTS(SELECT 1 FROM history_maintenance WHERE lease_until>?) ORDER BY next_at,updated LIMIT 1`, now.UnixNano(), now.UnixNano(), now.UnixNano()).Scan(&job.Chat, &job.Key, &payload, &job.Generation, &job.Attempts)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		token := make([]byte, 16)
		if _, err = rand.Read(token); err != nil {
			return err
		}
		job.Lease = hex.EncodeToString(token)
		job.Payload = json.RawMessage(payload)
		_, err = db.ExecContext(ctx, `UPDATE history_maintenance SET lease=?,lease_until=? WHERE chat=?`, job.Lease, now.Add(2*time.Minute).UnixNano(), job.Chat)
		found = err == nil
		return err
	})
	return job, found, err
}
func (s Store) FinishHistoryMaintenance(ctx context.Context, job HistoryMaintenance, now time.Time, more bool, failure error) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		var key, lease string
		var generation, attempts int
		err := db.QueryRowContext(ctx, `SELECT key,lease,generation,attempts FROM history_maintenance WHERE chat=?`, job.Chat).Scan(&key, &lease, &generation, &attempts)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if lease != job.Lease {
			return errors.New("summary maintenance lease changed")
		}
		if key != job.Key {
			failure = nil
			more = true
			attempts = 0
		}
		if failure == nil && generation == job.Generation && !more {
			_, err = db.ExecContext(ctx, `DELETE FROM history_maintenance WHERE chat=? AND lease=?`, job.Chat, job.Lease)
			return err
		}
		next := now.Add(5 * time.Second)
		message := ""
		if failure != nil {
			attempts++
			delay := min(time.Hour, time.Minute*time.Duration(1<<min(attempts-1, 6)))
			next = now.Add(delay)
			message = failure.Error()
			if len(message) > 512 {
				message = message[:512]
			}
		} else {
			attempts = 0
		}
		_, err = db.ExecContext(ctx, `UPDATE history_maintenance SET lease='',lease_until=0,attempts=?,next_at=?,last_error=? WHERE chat=? AND lease=?`, attempts, next.UnixNano(), message, job.Chat, job.Lease)
		return err
	})
}
