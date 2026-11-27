package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/retrieval"
)

// SyncRevision covers selection policy as well as evidence; sync must not lose
// a concurrent pin, snooze or correction. Derived lookup fields stay local.
func SyncRevision(r Record) string {
	r.ConceptID = ""
	r.RecallIssue = ""
	r.ReviewAfter = Record{}.ReviewAfter
	data, _ := json.Marshal(r)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type SyncSnapshot struct {
	Records  []Record
	Metadata map[string]json.RawMessage
}

func (s Store) SyncSnapshot() (SyncSnapshot, error) {
	release, err := s.readLock()
	if err != nil {
		return SyncSnapshot{}, err
	}
	defer release()
	records, err := s.list("", true, s.loadUnlocked, true)
	if err != nil {
		return SyncSnapshot{}, err
	}
	result := SyncSnapshot{Records: records, Metadata: map[string]json.RawMessage{}}
	for i := range result.Records {
		result.Records[i].ConceptID = ""
		result.Records[i].RecallIssue = ""
		result.Records[i].ReviewAfter = Record{}.ReviewAfter
	}
	bindings, err := s.bindings()
	if err != nil {
		return result, err
	}
	for key, value := range bindings {
		data, _ := json.Marshal(value)
		result.Metadata["alias/"+key] = data
	}
	for _, dir := range []string{".forgotten", ".forgotten-history", ".withdrawals", ".origins"} {
		entries, err := os.ReadDir(filepath.Join(s.root, dir))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return result, err
		}
		for _, entry := range entries {
			name := entry.Name()
			if dir == ".origins" {
				if !entry.IsDir() || !validConceptKey(name) {
					return result, errors.New("invalid memory origin directory")
				}
				origins, err := os.ReadDir(filepath.Join(s.root, dir, name))
				if err != nil {
					return result, err
				}
				for _, origin := range origins {
					if origin.IsDir() || origin.Type()&os.ModeSymlink != 0 || !validConceptKey(origin.Name()) {
						return result, errors.New("invalid memory origin")
					}
					result.Metadata["origin/"+name+"/"+origin.Name()] = json.RawMessage(`true`)
				}
			} else if dir == ".withdrawals" {
				id := strings.TrimSuffix(name, ".json")
				rule, err := s.loadWithdrawal(id)
				if err != nil {
					return result, err
				}
				data, _ := json.Marshal(rule)
				result.Metadata["withdrawal/"+id] = data
			} else {
				if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !validConceptKey(name) {
					return result, errors.New("invalid forgotten memory marker")
				}
				kind := "forgotten"
				if dir == ".forgotten-history" {
					kind = "history"
				}
				result.Metadata[kind+"/"+name] = json.RawMessage(`true`)
			}
			if len(result.Metadata) > 16384 {
				return result, errors.New("memory privacy metadata exceeds sync limit")
			}
		}
	}
	return result, nil
}

// ApplySyncRecord is an owning-store compare-and-swap, not a raw profile restore.
func (s Store) ApplySyncRecord(id, expected string, next *Record) error {
	release, err := s.lock()
	if err != nil {
		return err
	}
	defer release()
	current, err := s.loadUnlocked(id)
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
		return errors.New("memory changed during sync; retry with its current revision")
	}
	if next == nil {
		if !exists {
			return nil
		}
		bindings, err := s.bindings()
		if err != nil {
			return err
		}
		blocked, err := s.blockedConcept(bindings, current.GoalID, current.Subject)
		if err != nil {
			return err
		}
		if current.Subject != "" && blocked {
			if err = s.suppressHistory(current); err != nil {
				return err
			}
			if err = os.Remove(s.path(id)); err != nil {
				return err
			}
			s.notifyHistoryCache(id, current.GoalID, nil)
			return retrieval.DropID(filepath.Dir(filepath.Dir(s.root)), id)
		}
		return s.forgetRecord(current)
	}
	if next.ID != id || validate(*next) != nil {
		return errors.New("invalid synced memory")
	}
	bindings, err := s.bindings()
	if err != nil {
		return err
	}
	blocked, err := s.blockedConcept(bindings, next.GoalID, next.Subject)
	if err != nil {
		return err
	}
	if next.Subject != "" && blocked {
		return errors.New("synced memory belongs to a forgotten subject")
	}
	if exists && current.GoalID != next.GoalID {
		return errors.New("sync cannot change a memory scope")
	}
	if err := s.retainHistoryOrigin(*next); err != nil {
		return err
	}
	if err := s.write(*next, !exists); err != nil {
		return err
	}
	return retrieval.InvalidateID(filepath.Dir(filepath.Dir(s.root)), id)
}

func (s Store) ApplySyncMetadata(key string, expected, next json.RawMessage) error {
	release, err := s.lock()
	if err != nil {
		return err
	}
	defer release()
	parts := strings.Split(key, "/")
	if len(parts) < 2 || !validConceptKey(parts[1]) {
		return errors.New("invalid sync privacy identity")
	}
	id := parts[1]
	actual, err := s.syncMetadataValue(key)
	if err != nil {
		return err
	}
	if string(actual) == string(next) {
		return nil
	}
	if string(actual) != string(expected) {
		return errors.New("memory privacy metadata changed during sync")
	}
	switch parts[0] {
	case "alias":
		if len(parts) != 2 {
			return errors.New("invalid sync alias")
		}
		bindings, err := s.bindings()
		if err != nil {
			return err
		}
		if len(next) == 0 {
			return nil
		} // bindings and historical exclusions are monotone.
		var target string
		if json.Unmarshal(next, &target) != nil || !validConceptKey(target) {
			return errors.New("invalid sync alias root")
		}
		if old, ok := bindings[id]; ok && old != target {
			return errors.New("conflicting memory concept bindings require reconciliation")
		}
		if root, ok := bindings[target]; ok && root != target {
			return errors.New("conflicting memory concept root")
		}
		bindings[target] = target
		bindings[id] = target
		return s.publish(".concepts", bindings, 1<<20, false)
	case "forgotten", "history", "origin":
		directory := map[string]string{"forgotten": ".forgotten", "history": ".forgotten-history", "origin": ".origins"}[parts[0]]
		path := filepath.Join(s.root, directory, id)
		if parts[0] == "origin" {
			if len(parts) != 3 || !validConceptKey(parts[2]) {
				return errors.New("invalid sync history origin")
			}
			if err := privateDirectory(filepath.Join(s.root, ".origins")); err != nil {
				return err
			}
			path = filepath.Join(path, parts[2])
		} else if len(parts) != 2 {
			return errors.New("invalid sync marker")
		}
		if len(next) == 0 {
			if parts[0] != "forgotten" {
				return nil
			}
			err := os.Remove(path)
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if string(next) != "true" {
			return errors.New("invalid sync marker value")
		}
		if err := blockMarker(path); err != nil {
			return err
		}
		if parts[0] == "forgotten" {
			bindings, err := s.bindings()
			if err != nil {
				return err
			}
			records, err := s.list("", true, s.loadUnlocked, true)
			if err != nil {
				return err
			}
			for _, record := range records {
				if record.Subject == "" || bindings.resolve(record.GoalID, record.Subject) != id {
					continue
				}
				if err = s.suppressHistory(record); err != nil {
					return err
				}
				if err = os.Remove(s.path(record.ID)); err != nil {
					return err
				}
				s.notifyHistoryCache(record.ID, record.GoalID, nil)
				if err = retrieval.DropID(filepath.Dir(filepath.Dir(s.root)), record.ID); err != nil {
					return err
				}
			}
		}
		return nil
	case "withdrawal":
		if len(parts) != 2 {
			return errors.New("invalid sync withdrawal")
		}
		if len(next) == 0 {
			return nil
		}
		var rule WithdrawalRule
		if json.Unmarshal(next, &rule) != nil || rule.Version != 1 || rule.ID != id || rule.ForgottenAt.IsZero() || len(rule.Topic) > 1000 || strings.ContainsRune(rule.Topic, 0) || !rule.RestoredAt.IsZero() && rule.RestoredAt.Before(rule.ForgottenAt) {
			return errors.New("invalid synced withdrawal")
		}
		return s.writeWithdrawal(rule)
	}
	return errors.New("unsupported sync privacy record")
}

func (s Store) syncMetadataValue(key string) (json.RawMessage, error) {
	parts := strings.Split(key, "/")
	id := parts[1]
	if parts[0] == "alias" {
		bindings, err := s.bindings()
		if err != nil {
			return nil, err
		}
		if value, found := bindings[id]; found {
			data, _ := json.Marshal(value)
			return data, nil
		}
		return nil, nil
	}
	if parts[0] == "withdrawal" {
		rule, err := s.loadWithdrawal(id)
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(rule)
		return data, nil
	}
	directory := map[string]string{"forgotten": ".forgotten", "history": ".forgotten-history", "origin": ".origins"}[parts[0]]
	if directory == "" {
		return nil, errors.New("invalid sync metadata kind")
	}
	path := filepath.Join(s.root, directory, id)
	if parts[0] == "origin" {
		if len(parts) != 3 || !validConceptKey(parts[2]) {
			return nil, errors.New("invalid sync origin")
		}
		path = filepath.Join(path, parts[2])
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("invalid sync marker file")
	}
	return json.RawMessage(`true`), nil
}

// Synced content cannot reintroduce a subject already forgotten on this device.
func (s Store) SyncForgotten(r Record) (bool, error) {
	if r.Subject == "" {
		return false, nil
	}
	release, err := s.readLock()
	if err != nil {
		return false, err
	}
	defer release()
	bindings, err := s.bindings()
	if err != nil {
		return false, err
	}
	return s.blockedConcept(bindings, r.GoalID, r.Subject)
}
