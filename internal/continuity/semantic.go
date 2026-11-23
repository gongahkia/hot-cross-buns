package continuity

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

var errEmbeddingCount = errors.New("history embedding count mismatch")

// semanticHistory advances one checkpointed embedding page per request. The
// archive has no document-count cap, and provider failure leaves lexical recall.
func semanticHistory(ctx context.Context, s worksession.Store, memories memory.Store, model agent.Model, o Options, eligible func(worksession.HistoryMatch) (bool, error)) ([]worksession.HistoryMatch, error) {
	if o.Embedder == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	scope := hash(struct{ Goal, Chat string }{o.GoalID, func() string {
		if !o.ReferToChats {
			return o.ConversationID
		}
		return ""
	}()})
	provider := o.Embedder.ID()
	cursor, err := s.HistoryEmbeddingCursor(ctx, provider+":"+scope, nil)
	if err != nil {
		return nil, err
	}
	page, err := s.PendingHistoryVectors(ctx, provider, scope, cursor)
	if err != nil {
		return nil, err
	}
	var inputs []string
	var batch []worksession.HistoryMatch
	next := cursor
	for _, m := range page {
		next = m.ID
		ok, err := eligible(m)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		t, err := s.ReadHistoryMatch(ctx, m)
		if err != nil {
			continue
		}
		safe, err := screen(ctx, memories, model, o.GoalID, []worksession.ContextTurn{t})
		if err != nil {
			return nil, err
		}
		if len(safe) == 0 {
			if err := s.DropHistoryVectors(ctx, m.Chat, m.Key); err != nil {
				return nil, err
			}
			continue
		}
		batch = append(batch, m)
		inputs = append(inputs, t.User)
		if len(batch) == 15 {
			break
		}
	}
	if len(page) < 32 && (len(page) == 0 || next == page[len(page)-1].ID) {
		next = ""
	}
	inputs = append(inputs, Clip(o.Query, 8*1024))
	vectors, err := o.Embedder.Embed(ctx, inputs)
	if err != nil {
		return nil, err
	}
	if len(vectors) != len(inputs) {
		return nil, errEmbeddingCount
	}
	if len(batch) > 0 {
		if err := s.SaveHistoryVectors(ctx, provider, scope, batch, vectors[:len(batch)]); err != nil {
			return nil, err
		}
	}
	if _, err := s.HistoryEmbeddingCursor(ctx, provider+":"+scope, &next); err != nil {
		return nil, err
	}
	return s.SearchHistoryVectors(ctx, provider, scope, vectors[len(vectors)-1], 64)
}

// Reciprocal rank fusion preserves useful exact names while adding meaning-
// based candidates; incomparable cosine/BM25 scores are never added directly.
func fuseHistory(lexical, semantic []worksession.HistoryMatch) []worksession.HistoryMatch {
	byID := map[string]worksession.HistoryMatch{}
	for _, list := range [][]worksession.HistoryMatch{lexical, semantic} {
		for i, m := range list {
			v, ok := byID[m.ID]
			if !ok {
				v = m
				v.Score = 0
			}
			v.Score += 1 / float64(60+i+1)
			byID[m.ID] = v
		}
	}
	result := make([]worksession.HistoryMatch, 0, len(byID))
	for _, m := range byID {
		result = append(result, m)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Score == result[j].Score {
			return result[i].ID < result[j].ID
		}
		return result[i].Score > result[j].Score
	})
	return result
}
