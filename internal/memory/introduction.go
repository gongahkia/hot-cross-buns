package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/retrieval"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func introductionSubject(subject string) bool {
	subject = CanonicalSubject(subject)
	return subject == "profile.name" || subject == "preference.tone" || subject == "profile.projects"
}
func introductionRevision(records []Record) string {
	var selected []Record
	for _, record := range records {
		if record.GoalID == "" && introductionSubject(record.Subject) {
			selected = append(selected, record)
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].ID < selected[j].ID })
	data, _ := json.Marshal(selected)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
func (s Store) IntroductionRevision() (string, error) {
	records, err := s.List("", true)
	if err != nil {
		return "", err
	}
	return introductionRevision(records), nil
}

// A single explicit setup review captures all optional answers. It cannot
// silently replace a profile changed since that review or expand goal scope.
func (s Store) SaveIntroduction(values map[string]string, revision string) error {
	release, err := s.lock()
	if err != nil {
		return err
	}
	defer release()
	records, err := s.listUnlocked("", true)
	if err != nil {
		return err
	}
	if revision == "" || introductionRevision(records) != revision {
		return errors.New("your saved details changed; reopen the introduction before saving")
	}
	var updated []Record
	for _, subject := range []string{"profile.name", "preference.tone", "profile.projects"} {
		text := strings.TrimSpace(values[subject])
		if text == "" {
			continue
		}
		if len(text) > 2000 {
			return errors.New("keep each introduction answer under 2000 bytes")
		}
		kind := "fact"
		if subject == "preference.tone" {
			kind = "preference"
		}
		var existing *Record
		for _, record := range records {
			if CanonicalSubject(record.Subject) == subject && record.GoalID == "" {
				if existing != nil {
					return errors.New("reconcile duplicate profile memories before replacing them")
				}
				copy := record
				existing = &copy
			}
		}
		var record Record
		if existing != nil {
			record = *existing
			record.Text = text
			record.Source = "Introduction · saved together"
			record.SourceSHA256 = ""
			if record.Origin != nil {
				record.Origin = &ChatOrigin{ConversationID: record.Origin.ConversationID, RunID: record.Origin.RunID, Basis: "user-corrected"}
			}
			record.Context = nil
			record.ExpiresAt = time.Time{}
			record.UpdatedAt = s.nextUpdate(record.UpdatedAt)
		} else {
			record, err = s.newRecord(kind, text, "", "Introduction · saved together", "", time.Time{})
			if err != nil {
				return err
			}
		}
		record.Subject = subject
		record.observe("user-added", nil)
		if err := validate(record); err != nil {
			return err
		}
		updated = append(updated, record)
	}
	for _, record := range updated {
		create := true
		for _, prior := range records {
			if prior.ID == record.ID {
				create = false
			}
		}
		if err := s.unblockSubject("", record.Subject); err != nil {
			return err
		}
		if err := s.write(record, create); err != nil {
			return err
		}
		if err := retrieval.InvalidateID(filepath.Dir(filepath.Dir(s.root)), record.ID); err != nil {
			return err
		}
	}
	return nil
}
