package worksession

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

type InheritedDialogue struct {
	TurnID         string `json:"turn_id"`
	ConversationID string `json:"conversation_id"`
	SourceTurnID   string `json:"source_turn_id"`
	SHA256         string `json:"sha256"`
}

// ForkDialogueOnce copies visible conversation text, never captured execution inputs.
func (s Store) ForkDialogueOnce(parent, turnID string, expected uint64, request string, now time.Time) (Conversation, error) {
	c, err := s.Load(parent)
	if err != nil {
		return Conversation{}, err
	}
	selected, err := s.ReadDialogue(parent, turnID)
	if err != nil || selected.Revision != expected || (selected.State != "answered" && selected.State != "clarification") || selected.Response == "" || selected.Issue != "" {
		return Conversation{}, errors.New("the selected response changed or is not complete")
	}
	lineage, err := s.Lineage(parent, c.HeadRevision)
	if err != nil {
		return Conversation{}, err
	}
	boundary := ""
	for _, turn := range lineage {
		if !turn.CreatedAt.After(selected.CreatedAt) {
			boundary = turn.ID
		}
	}
	var seed *forkSeed
	if boundary != "" {
		turns, err := s.Lineage(parent, boundary)
		if err != nil {
			return Conversation{}, err
		}
		seed, err = s.revisionForkSeed(parent, boundary, turns)
		if err != nil {
			return Conversation{}, err
		}
	} else {
		seed = &forkSeed{info: BranchInfo{Version: 2, ParentConversationID: parent}}
	}
	seed.info.Version = 2
	seed.info.ParentTurnID = turnID
	if err := s.seedDialogue(seed, parent, selected.Sequence+1, selected.UpdatedAt); err != nil {
		return Conversation{}, err
	}
	if len(seed.dialogue) == 0 || seed.dialogue[len(seed.dialogue)-1].ID != turnID || seed.dialogue[len(seed.dialogue)-1].Revision != expected {
		return Conversation{}, errors.New("selected dialogue boundary is unavailable")
	}
	return s.createChatOnce(c.SourcePath, request, now, seed)
}

func (s Store) seedDialogue(seed *forkSeed, parent string, before uint64, boundary time.Time) error {
	turns := []DialogueTurn{}
	for {
		page, more, err := s.DialoguePage(parent, before, 100)
		if err != nil {
			return err
		}
		kept := []DialogueTurn{}
		for _, turn := range page {
			if !turn.UpdatedAt.After(boundary) {
				kept = append(kept, turn)
			}
		}
		turns = append(kept, turns...)
		if len(turns)+len(seed.turns) > 256 {
			return errors.New("branch context exceeds 256 turns")
		}
		if !more {
			break
		}
		before = page[0].Sequence
	}
	root, err := workspace.Open(s.root)
	if err != nil {
		return err
	}
	inherited, err := s.Branch(parent)
	if err != nil {
		return err
	}
	total := seed.bytes
	hash := sha256.New()
	hash.Write([]byte(seed.digest))
	for _, turn := range turns {
		if turn.UpdatedAt.After(boundary) || turn.Response == "" || turn.Issue != "" {
			continue
		}
		switch turn.State {
		case "answered", "clarification", "guided", "stopped", "delegated":
		default:
			continue
		}
		raw, err := root.ReadRegularFile(filepath.Join(parent, "dialogue", dialogueFilename(turn)), maxDialogueTurnBytes)
		if err != nil {
			return err
		}
		total += len(raw)
		if total > 32*1024*1024 {
			return errors.New("dialogue branch context exceeds 32 MiB")
		}
		hash.Write(raw)
		sum := sha256.Sum256(raw)
		origin := InheritedDialogue{TurnID: turn.ID, ConversationID: parent, SourceTurnID: turn.ID, SHA256: hex.EncodeToString(sum[:])}
		if inherited != nil {
			for _, prior := range inherited.Dialogue {
				if prior.TurnID == turn.ID {
					origin = prior
					origin.TurnID = turn.ID
					break
				}
			}
		}
		seed.info.Dialogue = append(seed.info.Dialogue, origin)
		seed.dialogue = append(seed.dialogue, turn)
	}
	if len(seed.dialogue) > 0 {
		seed.digest = hex.EncodeToString(hash.Sum(nil))
	}
	seed.bytes = total
	return nil
}

func cleanBranchDialogue(original DialogueTurn, conversation string) DialogueTurn {
	client := "branch-" + original.ID[:40]
	decision, _ := json.Marshal(map[string]string{"kind": "reply", "text": original.Response})
	return DialogueTurn{Version: 1, Revision: 1, Sequence: original.Sequence, ID: dialogueIdentity(client), ClientID: client, ConversationID: conversation, Text: original.Text, Options: json.RawMessage(`{"version":1,"run_options":{}}`), State: "answered", Decision: decision, Response: original.Response, CreatedAt: original.CreatedAt, UpdatedAt: original.UpdatedAt}
}
