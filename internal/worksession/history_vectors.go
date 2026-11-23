package worksession

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"math"
	"sort"
)

// PendingHistoryVectors pages over chunks without loading the archive in memory.
// The caller must check canonical source, scope and withdrawals before embedding.
func (s Store) PendingHistoryVectors(ctx context.Context, provider, scope, after string) ([]HistoryMatch, error) {
	var result []HistoryMatch
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT c.id,c.chat,c.key,c.part,c.text,c.digest FROM history_chunks c WHERE c.id>? AND NOT EXISTS(SELECT 1 FROM semantic_vectors v WHERE v.provider=? AND v.scope=? AND v.id=c.id AND v.hash=c.digest) ORDER BY c.id LIMIT 32`, after, provider, scope)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m HistoryMatch
			if err := rows.Scan(&m.ID, &m.Chat, &m.Key, &m.Part, &m.Text, &m.Digest); err != nil {
				return err
			}
			result = append(result, m)
		}
		return rows.Err()
	})
	return result, err
}

func encodeHistoryVector(v []float32) ([]byte, error) {
	if len(v) < 16 || len(v) > 4096 {
		return nil, errors.New("invalid history embedding dimension")
	}
	var norm float64
	for _, x := range v {
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return nil, errors.New("non-finite history embedding")
		}
		norm += float64(x) * float64(x)
	}
	if norm <= 0 {
		return nil, errors.New("empty history embedding")
	}
	data := make([]byte, 4*len(v))
	norm = math.Sqrt(norm)
	for i, x := range v {
		binary.LittleEndian.PutUint32(data[i*4:], math.Float32bits(float32(float64(x)/norm)))
	}
	return data, nil
}

func (s Store) SaveHistoryVectors(ctx context.Context, provider, scope string, matches []HistoryMatch, vectors [][]float32) error {
	if len(matches) == 0 || len(matches) > 16 || len(vectors) != len(matches) {
		return errors.New("invalid history embedding batch")
	}
	blobs := make([][]byte, len(vectors))
	dimension := 0
	for i, v := range vectors {
		data, err := encodeHistoryVector(v)
		if err != nil {
			return err
		}
		if dimension != 0 && len(data) != dimension {
			return errors.New("inconsistent history embedding dimensions")
		}
		dimension = len(data)
		blobs[i] = data
	}
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for i, m := range matches {
			// Compare-and-set: a concurrent source correction cannot resurrect its vector.
			_, err := tx.ExecContext(ctx, `INSERT INTO semantic_vectors(provider,scope,id,hash,vector) SELECT ?,?,id,digest,? FROM history_chunks WHERE id=? AND digest=? ON CONFLICT(provider,scope,id) DO UPDATE SET hash=excluded.hash,vector=excluded.vector`, provider, scope, blobs[i], m.ID, m.Digest)
			if err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

// SearchHistoryVectors streams normalized vectors and retains only the best K.
// It has bounded memory; an archive's length does not limit what can be searched.
func (s Store) SearchHistoryVectors(ctx context.Context, provider, scope string, query []float32, limit int) ([]HistoryMatch, error) {
	if limit < 1 || limit > 128 {
		return nil, errors.New("invalid semantic history search limit")
	}
	data, err := encodeHistoryVector(query)
	if err != nil {
		return nil, err
	}
	q := make([]float32, len(query))
	for i := range q {
		q[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[i*4:]))
	}
	var result []HistoryMatch
	err = s.HistoryCache(ctx, func(db *sql.DB) error {
		rows, err := db.QueryContext(ctx, `SELECT c.id,c.chat,c.key,c.part,c.digest,v.vector FROM semantic_vectors v JOIN history_chunks c ON c.id=v.id AND c.digest=v.hash WHERE v.provider=? AND v.scope=?`, provider, scope)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m HistoryMatch
			var v []byte
			if err := rows.Scan(&m.ID, &m.Chat, &m.Key, &m.Part, &m.Digest, &v); err != nil {
				return err
			}
			if len(v) != len(data) {
				continue
			}
			score := float64(0)
			valid := true
			for i, x := range q {
				y := math.Float32frombits(binary.LittleEndian.Uint32(v[i*4:]))
				if math.IsNaN(float64(y)) || math.IsInf(float64(y), 0) {
					valid = false
					break
				}
				score += float64(x) * float64(y)
			}
			if !valid || score < 0.3 {
				continue
			}
			m.Score = score
			result = append(result, m)
			sort.Slice(result, func(i, j int) bool {
				if result[i].Score == result[j].Score {
					return result[i].ID < result[j].ID
				}
				return result[i].Score > result[j].Score
			})
			if len(result) > limit {
				result = result[:limit]
			}
		}
		return rows.Err()
	})
	return result, err
}

func (s Store) HistoryEmbeddingCursor(ctx context.Context, scope string, next *string) (string, error) {
	var cursor string
	err := s.HistoryCache(ctx, func(db *sql.DB) error {
		key := "embedding:" + scope
		if next != nil {
			_, err := db.ExecContext(ctx, `INSERT INTO history_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, *next)
			return err
		}
		err := db.QueryRowContext(ctx, `SELECT value FROM history_meta WHERE key=?`, key).Scan(&cursor)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	})
	return cursor, err
}

func (s Store) DropHistoryVectors(ctx context.Context, chat, key string) error {
	return s.HistoryCache(ctx, func(db *sql.DB) error {
		_, err := db.ExecContext(ctx, `DELETE FROM semantic_vectors WHERE id IN(SELECT id FROM history_chunks WHERE chat=? AND(?='' OR key=?))`, chat, key, key)
		return err
	})
}
