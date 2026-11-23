package worksession

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

// ContextTurn exposes only public conversation text. Captured options, files,
// tool replay, credentials and action receipts never enter a continuity summary.
type ContextTurn struct {
	Sequence  uint64    `json:"sequence,omitempty"`
	ID        string    `json:"id"`
	User      string    `json:"user"`
	Assistant string    `json:"assistant,omitempty"`
	State     string    `json:"state"`
	TaskChat  string    `json:"task_chat,omitempty"`
	At        time.Time `json:"at"`
}

const MaxContextTurns = 4096

// ContextHistory follows the selected Work ancestry and this chat's dialogue.
// A message's admission boundary excludes itself and subsequently admitted text.
func (s Store) ContextHistory(id string, before uint64, at time.Time) ([]ContextTurn, error) {
	c, err := s.Load(id)
	if err != nil {
		return nil, err
	}
	var turns []ContextTurn
	bytes := 0
	add := func(turn ContextTurn) error {
		bytes += len(turn.User) + len(turn.Assistant)
		if len(turns) >= MaxContextTurns || bytes > 16*1024*1024 {
			return errors.New("conversation history exceeds the bounded continuity scan; original history is retained")
		}
		turns = append(turns, turn)
		return nil
	}
	for cursor := before; ; {
		page, more, err := s.DialoguePage(id, cursor, 100)
		if err != nil {
			return nil, err
		}
		for _, turn := range page {
			if !at.IsZero() && !turn.CreatedAt.Before(at) {
				continue
			}
			response := turn.Response
			state, task := turn.State, turn.TaskChat
			if !at.IsZero() && turn.UpdatedAt.After(at) {
				response = ""
				state = "unconfirmed_at_admission"
				task = ""
			}
			if err := add(ContextTurn{Sequence: turn.Sequence, ID: "dialogue:" + turn.ID, User: turn.Text, Assistant: response, State: state, TaskChat: task, At: turn.CreatedAt}); err != nil {
				return nil, err
			}
		}
		if !more {
			break
		}
		cursor = page[0].Sequence
	}
	seen := map[string]bool{}
	for revision := c.HeadRevision; revision != ""; {
		if seen[revision] {
			return nil, errors.New("conversation revision cycle")
		}
		seen[revision] = true
		if len(seen) > MaxContextTurns {
			return nil, errors.New("conversation ancestry exceeds the continuity scan bound")
		}
		r, err := s.LoadRevision(id, revision)
		if err != nil {
			return nil, err
		}
		if at.IsZero() || r.CreatedAt.Before(at) {
			if err := add(ContextTurn{ID: "work:" + r.ID, User: r.Objective, Assistant: r.FinalText, State: r.Status, At: r.CreatedAt}); err != nil {
				return nil, err
			}
		}
		revision = r.ParentRevisionID
	}
	sort.Slice(turns, func(i, j int) bool {
		if turns[i].At.Equal(turns[j].At) {
			if turns[i].Sequence > 0 && turns[j].Sequence > 0 {
				return turns[i].Sequence < turns[j].Sequence
			}
			return turns[i].ID < turns[j].ID
		}
		return turns[i].At.Before(turns[j].At)
	})
	return turns, nil
}

// ContextDigest detects rewritten, removed or newly completed source turns.
func ContextDigest(turns []ContextTurn) string {
	if len(turns) == 0 {
		turns = nil
	}
	data, _ := json.Marshal(turns)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type ContinuitySummary struct {
	Version        int       `json:"version"`
	Revision       uint64    `json:"revision"`
	ConversationID string    `json:"conversation_id"`
	Epoch          string    `json:"epoch"`
	Covered        int       `json:"covered"`
	Digest         string    `json:"digest"`
	Text           string    `json:"text"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func validContinuity(v ContinuitySummary, id string) bool {
	return v.Version == 1 && v.Revision > 0 && v.ConversationID == id && v.Covered >= 0 && v.Covered <= MaxContextTurns && len(v.Epoch) == 64 && len(v.Digest) == 64 && utf8.ValidString(v.Text) && len(v.Text) <= 12*1024 && !v.UpdatedAt.IsZero()
}

func (s Store) ReadContinuity(id string) (ContinuitySummary, error) {
	if _, err := s.Load(id); err != nil {
		return ContinuitySummary{}, err
	}
	root, err := workspace.Open(s.root)
	if err != nil {
		return ContinuitySummary{}, err
	}
	data, err := root.ReadRegularFile(filepath.Join(id, "continuity.json"), 32*1024)
	if errors.Is(err, os.ErrNotExist) {
		return ContinuitySummary{}, nil
	}
	if err != nil {
		return ContinuitySummary{}, err
	}
	var v ContinuitySummary
	if json.Unmarshal(data, &v) != nil || !validContinuity(v, id) {
		return ContinuitySummary{}, errors.New("saved conversation summary is invalid; original messages are retained")
	}
	return v, nil
}

// SaveContinuity uses an optimistic revision: a slow request cannot overwrite a
// newer summary. Deleting a chat never recreates it through summary publication.
func (s Store) SaveContinuity(v ContinuitySummary, expected uint64) error {
	if expected == ^uint64(0) {
		return errors.New("summary revision exhausted")
	}
	v.Version, v.Revision = 1, expected+1
	if !validContinuity(v, v.ConversationID) || strings.TrimSpace(v.Text) == "" && v.Covered != 0 {
		return errors.New("invalid conversation summary")
	}
	lock, err := s.requestLock(v.ConversationID, ".continuity.lock", false)
	if err != nil {
		return err
	}
	defer lock.Close()
	prior, err := s.ReadContinuity(v.ConversationID)
	if err != nil {
		return err
	}
	if prior.Revision != expected {
		return errors.New("conversation summary changed during preparation")
	}
	root, err := workspace.Open(s.root)
	if err != nil {
		return err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return root.WriteRegularFileAtomic(filepath.Join(v.ConversationID, "continuity.json"), data, 32*1024)
}
