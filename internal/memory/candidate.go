package memory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

// Candidates retain source statements for human review. Neither their presence
// nor model-written significance makes them active personal knowledge.
type Candidate struct {
	ID            string       `json:"id"`
	Input         ChatInput    `json:"input"`
	Plan          SemanticPlan `json:"plan"`
	SnapshotToken string       `json:"snapshot_token"`
	StatementHash string       `json:"statement_hash"`
	Status        string       `json:"status"`
	RecordID      string       `json:"record_id,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

func (s Store) ProposeCandidate(ctx context.Context, input ChatInput, plan SemanticPlan) (Candidate, error) {
	if err := ctx.Err(); err != nil {
		return Candidate{}, err
	}
	if err := validateChatInput(input); err != nil {
		return Candidate{}, err
	}
	if input.Context == nil {
		return Candidate{}, errors.New("a memory candidate needs significance and temporal context")
	}
	if err := input.Context.Validate(); err != nil {
		return Candidate{}, err
	}
	if plan.Relation == Uncertain || plan.Relation == Withdrawn {
		return Candidate{}, errors.New("resolve uncertain or withdrawn meaning before proposing memory")
	}
	release, err := s.lock()
	if err != nil {
		return Candidate{}, err
	}
	defer release()
	current, err := s.semanticSnapshotUnlocked(input.GoalID, input.ExcludedIDs)
	if err != nil {
		return Candidate{}, err
	}
	if !current.Complete || current.Token != plan.Snapshot.Token || plan.StatementSHA256 != textDigest(input.Quote) {
		return Candidate{}, errors.New("memory changed before the significance proposal; inspect it again")
	}
	data, _ := json.Marshal([]any{input.RunID, input.Quote, input.Subject, input.Context})
	sum := sha256.Sum256(data)
	id := "candidate-" + hex.EncodeToString(sum[:12])
	if old, err := s.loadCandidate(id); err == nil {
		return old, nil
	} else if !os.IsNotExist(err) {
		return Candidate{}, err
	}
	now := s.clock()
	c := Candidate{ID: id, Input: input, Plan: plan, SnapshotToken: current.Token, StatementHash: plan.StatementSHA256, Status: "pending", CreatedAt: now, UpdatedAt: now}
	return c, s.publish("."+id+".json", c, 32*1024, true)
}

func (s Store) loadCandidate(id string) (Candidate, error) {
	var c Candidate
	if !strings.HasPrefix(id, "candidate-") || len(id) != 34 {
		return c, errors.New("invalid memory candidate")
	}
	if _, err := hex.DecodeString(id[10:]); err != nil {
		return c, errors.New("invalid memory candidate")
	}
	root, err := os.OpenRoot(s.root)
	if err != nil {
		return c, err
	}
	defer root.Close()
	info, err := root.Lstat("." + id + ".json")
	if err != nil {
		return c, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return c, errors.New("candidate must be a regular file")
	}
	f, err := root.Open("." + id + ".json")
	if err != nil {
		return c, err
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 32*1024 {
		return c, errors.New("invalid memory candidate file")
	}
	if err := json.NewDecoder(f).Decode(&c); err != nil {
		return c, err
	}
	if c.ID != id || (c.Status == "pending" && validateChatInput(c.Input) != nil) || c.Input.Context == nil || c.Input.Context.Validate() != nil || c.CreatedAt.IsZero() || len(c.SnapshotToken) != 64 || len(c.StatementHash) != 64 {
		return c, errors.New("invalid stored memory candidate")
	}
	return c, nil
}

func (s Store) Candidates() ([]Candidate, error) {
	release, err := s.readLock()
	if err != nil {
		return nil, err
	}
	defer release()
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	result := []Candidate{}
	snapshots := map[string]SemanticSnapshot{}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".candidate-") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		c, err := s.loadCandidate(strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "."), ".json"))
		if err != nil {
			return nil, err
		}
		if c.Status != "pending" {
			continue
		}
		key := c.Input.GoalID + strings.Join(c.Input.ExcludedIDs, "\x00")
		snapshot, found := snapshots[key]
		if !found {
			snapshot, err = s.semanticSnapshotUnlocked(c.Input.GoalID, c.Input.ExcludedIDs)
			if err != nil {
				return nil, err
			}
			snapshots[key] = snapshot
		}
		if snapshot.Token != c.SnapshotToken {
			c.Status = "stale"
			c.Input.Quote = ""
			c.Input.Subject = "Stale memory suggestion"
			c.Input.Context = &Context{Why: "Sources changed; create a fresh proposal", Importance: "useful", State: "current"}
		}
		result = append(result, c)
		if len(result) == 128 {
			break
		}
	}
	return result, nil
}

func (s Store) ReviewCandidate(ctx context.Context, id, revision, action string) (Record, error) {
	release, err := s.lock()
	if err != nil {
		return Record{}, err
	}
	defer release()
	c, err := s.loadCandidate(id)
	if err != nil {
		return Record{}, err
	}
	if c.Status != "pending" || c.UpdatedAt.Format(time.RFC3339Nano) != revision {
		return Record{}, errors.New("candidate changed; reopen its review")
	}
	if action == "reject" {
		c.Status = "rejected"
		c.Input.Quote = ""
		c.UpdatedAt = s.nextUpdate(c.UpdatedAt)
		return Record{}, s.publish("."+id+".json", c, 32*1024, false)
	}
	if action != "accept" {
		return Record{}, errors.New("choose accept or reject")
	}
	snapshot, err := s.semanticSnapshotUnlocked(c.Input.GoalID, c.Input.ExcludedIDs)
	if err != nil {
		return Record{}, err
	}
	if !snapshot.Complete || snapshot.Token != c.SnapshotToken {
		return Record{}, errors.New("candidate sources changed; ask for a fresh significance proposal")
	}
	c.Plan.Snapshot = snapshot
	c.Plan.StatementSHA256 = c.StatementHash
	record, err := s.applySemanticChatUnlocked(ctx, c.Input, c.Plan, true)
	if err != nil {
		return Record{}, err
	}
	c.Status = "accepted"
	c.RecordID = record.ID
	c.Input.Quote = ""
	c.UpdatedAt = s.nextUpdate(c.UpdatedAt)
	return record, s.publish("."+id+".json", c, 32*1024, false)
}
