package knowledge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/retrieval"
)

func SyncRevision(d Document) string {
	data, _ := json.Marshal(struct {
		Metadata Document
		Body     string
	}{d, d.Body})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s Store) ApplySyncNote(id, expected string, next *Document) error {
	release, err := s.lock(false)
	if err != nil {
		return err
	}
	defer release()
	if !validID("note", id) {
		return errors.New("invalid sync note identity")
	}
	current, err := s.load("note", id)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	revision := ""
	if exists {
		revision = SyncRevision(current)
	}
	if next == nil && !exists {
		return nil
	}
	if revision != expected {
		return errors.New("note changed during sync; inspect the current revision")
	}
	if next == nil {
		if !exists {
			return nil
		}
		if err := s.remove("note", id); err != nil {
			return err
		}
		return retrieval.DropID(filepath.Dir(filepath.Dir(s.root)), id)
	}
	if next.ID != id || next.Kind != "note" || next.Routine != nil || next.Enabled || validate(*next) != nil {
		return errors.New("invalid synced reference note")
	}
	if exists && current.GoalID != next.GoalID {
		return errors.New("sync cannot change note scope")
	}
	if exists {
		err = s.write(*next)
	} else {
		err = s.create(*next)
	}
	if err != nil {
		return err
	}
	return retrieval.InvalidateID(filepath.Dir(filepath.Dir(s.root)), id)
}
