package worksession

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSummaryQueueBackoffSurvivesNewMessagesAndRestart(t *testing.T) {
	root := t.TempDir()
	s, _ := Open(root)
	chat, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now()
	key := strings.Repeat("a", 64)
	if err := s.QueueHistoryMaintenance(ctx, chat.ID, key, json.RawMessage(`{"before":1}`), now); err != nil {
		t.Fatal(err)
	}
	job, ok, err := s.ClaimHistoryMaintenance(ctx, now)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	if _, ok, err = s.ClaimHistoryMaintenance(ctx, now); err != nil || ok {
		t.Fatal("duplicate lease", ok, err)
	}
	if err := s.FinishHistoryMaintenance(ctx, job, now, false, errors.New("provider unavailable")); err != nil {
		t.Fatal(err)
	}
	s, _ = Open(root)
	if err := s.QueueHistoryMaintenance(ctx, chat.ID, key, json.RawMessage(`{"before":2}`), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, ok, err = s.ClaimHistoryMaintenance(ctx, now.Add(59*time.Second)); err != nil || ok {
		t.Fatal("new message reset backoff", ok, err)
	}
	job, ok, err = s.ClaimHistoryMaintenance(ctx, now.Add(time.Minute))
	if err != nil || !ok || job.Attempts != 1 || string(job.Payload) != `{"before":2}` {
		t.Fatal(job, ok, err)
	}
	if err := s.FinishHistoryMaintenance(ctx, job, now.Add(time.Minute), false, errors.New("still unavailable")); err != nil {
		t.Fatal(err)
	}
	if _, ok, err = s.ClaimHistoryMaintenance(ctx, now.Add(2*time.Minute)); err != nil || ok {
		t.Fatal("retry did not back off exponentially", ok, err)
	}
	job, ok, err = s.ClaimHistoryMaintenance(ctx, now.Add(3*time.Minute))
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	if err := s.FinishHistoryMaintenance(ctx, job, now.Add(3*time.Minute), false, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok, err = s.ClaimHistoryMaintenance(ctx, now.Add(24*time.Hour)); err != nil || ok {
		t.Fatal("completed request repeated", ok, err)
	}
}
func TestSummaryQueueCrashLeaseAndConcurrentRefresh(t *testing.T) {
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	ctx := context.Background()
	now := time.Now()
	key := strings.Repeat("a", 64)
	if err := s.QueueHistoryMaintenance(ctx, chat.ID, key, json.RawMessage(`{}`), now); err != nil {
		t.Fatal(err)
	}
	old, _, _ := s.ClaimHistoryMaintenance(ctx, now)
	next, ok, err := s.ClaimHistoryMaintenance(ctx, now.Add(121*time.Second))
	if err != nil || !ok || next.Lease == old.Lease {
		t.Fatal(ok, err)
	}
	if err := s.VerifyHistoryMaintenanceClaim(ctx, old, now.Add(121*time.Second)); err == nil {
		t.Fatal("stale claim remained valid before inference/publication")
	}
	if err := s.VerifyHistoryMaintenanceClaim(ctx, next, now.Add(121*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishHistoryMaintenance(ctx, old, now, false, nil); err == nil {
		t.Fatal("stale worker completed reclaimed request")
	}
	if err := s.QueueHistoryMaintenance(ctx, chat.ID, strings.Repeat("b", 64), json.RawMessage(`{"new":true}`), now.Add(122*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishHistoryMaintenance(ctx, next, now.Add(123*time.Second), false, errors.New("old provider failed")); err != nil {
		t.Fatal(err)
	}
	fresh, ok, err := s.ClaimHistoryMaintenance(ctx, now.Add(129*time.Second))
	if err != nil || !ok || fresh.Attempts != 0 || fresh.Key == key {
		t.Fatal(fresh, ok, err)
	}
}

func TestSummaryClaimsSerializeDifferentConversationsInOneProfile(t *testing.T) {
	s, _ := Open(t.TempDir())
	a, _ := s.CreateChat(t.TempDir(), time.Now())
	b, _ := s.CreateChat(t.TempDir(), time.Now())
	now := time.Now()
	ctx := context.Background()
	for _, chat := range []string{a.ID, b.ID} {
		if err := s.QueueHistoryMaintenance(ctx, chat, strings.Repeat("a", 64), json.RawMessage(`{}`), now); err != nil {
			t.Fatal(err)
		}
	}
	first, ok, err := s.ClaimHistoryMaintenance(ctx, now)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	if _, ok, err = s.ClaimHistoryMaintenance(ctx, now); err != nil || ok {
		t.Fatal("profile started concurrent summary inference", ok, err)
	}
	if err := s.FinishHistoryMaintenance(ctx, first, now, false, nil); err != nil {
		t.Fatal(err)
	}
	second, ok, err := s.ClaimHistoryMaintenance(ctx, now)
	if err != nil || !ok || second.Chat == first.Chat {
		t.Fatal("next conversation did not progress", second, ok, err)
	}
}
