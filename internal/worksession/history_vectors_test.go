package worksession

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"
)

func TestHistoryVectorsAreVersionedAndValidateProviderOutput(t *testing.T) {
	ctx := context.Background()
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	turn, err := s.AdmitDialogue(chat.ID, "vector-history-source-001", "A quince garden", json.RawMessage(`{}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	matches, err := s.PendingHistoryVectors(ctx, "test", "scope", "")
	if err != nil || len(matches) != 1 {
		t.Fatal(matches, err)
	}
	vector := make([]float32, 16)
	vector[0] = 1
	for _, bad := range [][]float32{nil, {0, 1}, make([]float32, 16), append([]float32{float32(math.NaN())}, make([]float32, 15)...)} {
		if err := s.SaveHistoryVectors(ctx, "test", "scope", matches, [][]float32{bad}); err == nil {
			t.Fatal("malformed provider vector persisted")
		}
	}
	if err := s.SaveHistoryVectors(ctx, "test", "scope", matches, [][]float32{vector}); err != nil {
		t.Fatal(err)
	}
	got, err := s.SearchHistoryVectors(ctx, "test", "scope", vector, 8)
	if err != nil || len(got) != 1 {
		t.Fatal(got, err)
	}
	if got, err := s.SearchHistoryVectors(ctx, "other-provider", "scope", vector, 8); err != nil || len(got) != 0 {
		t.Fatal("provider scopes mixed", got, err)
	}
	turn.State = "routing"
	if _, err := s.UpdateDialogue(turn, turn.Revision); err != nil {
		t.Fatal(err)
	}
	// A delayed embedding response for the old source version cannot restore it.
	if err := s.SaveHistoryVectors(ctx, "test", "scope", matches, [][]float32{vector}); err != nil {
		t.Fatal(err)
	}
	got, err = s.SearchHistoryVectors(ctx, "test", "scope", vector, 8)
	if err != nil || len(got) != 0 {
		t.Fatal("stale vector resurrected", got, err)
	}
}

func TestHistoryVectorSearchHasNoLegacy4096DocumentCap(t *testing.T) {
	ctx := context.Background()
	s, _ := Open(t.TempDir())
	v := make([]float32, 16)
	v[0] = 1
	blob, _ := encodeHistoryVector(v)
	// Populate the disposable vector cache directly to exercise streaming search at
	// scale independently of canonical-file I/O, covered by index integration tests.
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for i := 0; i < 5000; i++ {
			id := fmt.Sprintf("vector-%05d", i)
			if _, err := tx.ExecContext(ctx, `INSERT INTO history_chunks VALUES(?,?,?,?,?,?)`, id, "chat", "work:source", 0, "public excerpt", "digest"); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO semantic_vectors VALUES(?,?,?,?,?)`, "test", "scope", id, "digest", blob); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.SearchHistoryVectors(ctx, "test", "scope", v, 4)
	if err != nil || len(got) != 4 || got[0].ID != "vector-00000" {
		t.Fatal(got, err)
	}
}
