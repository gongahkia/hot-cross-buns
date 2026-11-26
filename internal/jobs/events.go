package jobs

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

type EventTrigger struct {
	Types []string          `json:"types"`
	Match map[string]string `json:"match,omitempty"`
}

func (t EventTrigger) Validate() error {
	if len(t.Types) < 1 || len(t.Types) > 16 || len(t.Match) > 16 {
		return errors.New("event triggers need 1–16 event types and at most 16 exact matching fields")
	}
	for _, kind := range t.Types {
		if kind == "" || len(kind) > 128 || strings.ContainsAny(kind, "\x00\r\n") {
			return errors.New("invalid event type")
		}
	}
	for key, value := range t.Match {
		if key == "" || len(key) > 128 || len(value) > 1024 || strings.ContainsAny(key+value, "\x00\r\n") {
			return errors.New("invalid event match")
		}
	}
	return nil
}

type InputEvent struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Policy     string          `json:"policy"`
	ReceivedAt time.Time       `json:"received_at"`
	Data       json.RawMessage `json:"data"`
}

type eventQueue struct {
	Events []InputEvent `json:"events"`
}

func (s Store) eventQueue(id string) (eventQueue, error) {
	if invalidID(id) {
		return eventQueue{}, errors.New("invalid event task")
	}
	var queue eventQueue
	path := filepath.Join(s.root, "inputs", id+".json")
	if info, err := os.Lstat(path); err == nil && info.Size() > 10*1024*1024 {
		return queue, errors.New("event queue exceeds its storage limit")
	}
	if err := readJSON(path, &queue); err != nil && !errors.Is(err, os.ErrNotExist) {
		return queue, err
	}
	if len(queue.Events) > 4096 {
		return queue, errors.New("event queue is full")
	}
	return queue, nil
}

// EnqueueEvent accepts data only after the caller authenticates the endpoint.
// The exact reviewed definition, event type and field filters are rechecked.
func (s Store) EnqueueEvent(id, policy, delivery, kind string, data json.RawMessage, now time.Time) (bool, error) {
	if delivery == "" || len(delivery) > 256 || len(data) > 16384 || now.IsZero() {
		return false, errors.New("invalid or oversized event")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return false, errors.New("event data must be a JSON object")
	}
	unlock, err := s.lockDefinitions()
	if err != nil {
		return false, err
	}
	defer unlock()
	d, err := s.Load(id)
	if err != nil {
		return false, err
	}
	actual, _ := d.PolicyDigest()
	if actual != policy || !d.Enabled || d.Expired(now) || d.Trigger == nil {
		return false, errors.New("event task changed, paused or ended; review its endpoint again")
	}
	if !slices.Contains(d.Trigger.Types, kind) {
		return false, errors.New("event type does not match this task")
	}
	for key, wanted := range d.Trigger.Match {
		var value string
		if json.Unmarshal(fields[key], &value) != nil || value != wanted {
			return false, errors.New("event fields do not match this task")
		}
	}
	queue, err := s.eventQueue(id)
	if err != nil {
		return false, err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(delivery)))
	for _, event := range queue.Events {
		if event.ID == hash {
			return false, nil
		}
	}
	// Retain replay identities for thirty days; never discard a pending input.
	pending, err := s.PendingEvents(d)
	if err != nil {
		return false, err
	}
	keep := map[string]bool{}
	for _, event := range pending {
		keep[event.ID] = true
	}
	filtered := queue.Events[:0]
	for _, event := range queue.Events {
		if keep[event.ID] || now.Sub(event.ReceivedAt) < 30*24*time.Hour {
			if !keep[event.ID] {
				event.Data = nil
			}
			filtered = append(filtered, event)
		}
	}
	queue.Events = filtered
	if len(queue.Events) >= 4096 || len(pending) >= 64 {
		return false, errors.New("event queue capacity reached; inspect task history before sending more")
	}
	queue.Events = append(queue.Events, InputEvent{ID: hash, Type: kind, Policy: policy, ReceivedAt: now.UTC(), Data: append(json.RawMessage{}, data...)})
	if err := privatefs.MkdirAll(filepath.Join(s.root, "inputs")); err != nil {
		return false, err
	}
	return true, writeJSON(filepath.Join(s.root, "inputs", id+".json"), queue)
}

func (s Store) PendingEvents(d Definition) ([]InputEvent, error) {
	queue, err := s.eventQueue(d.ID)
	if err != nil {
		return nil, err
	}
	history, err := s.History(d.ID, 0)
	if err != nil {
		return nil, err
	}
	claimed := map[string]bool{}
	for _, attempt := range history {
		for _, event := range attempt.InputEvents {
			claimed[event.ID] = true
		}
	}
	policy, _ := d.PolicyDigest()
	var pending []InputEvent
	for _, event := range queue.Events {
		if event.Policy == policy && !claimed[event.ID] {
			pending = append(pending, event)
		}
	}
	return pending, nil
}

func (s Store) EventDue(d Definition, now time.Time) (time.Time, bool, error) {
	if d.Trigger == nil || !d.Enabled || d.BeforeStart(now) || d.Expired(now) {
		return time.Time{}, false, nil
	}
	pending, err := s.PendingEvents(d)
	minute := now.UTC().Truncate(time.Minute)
	return minute, len(pending) > 0 && d.LastScheduledAt.Before(minute), err
}

type eventSchedule struct{}

func (eventSchedule) Next(time.Time) time.Time { return time.Time{} }
