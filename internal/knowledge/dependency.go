package knowledge

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

// A dependency pins source content and scope, not a filename or a similarity.
// Reads validate transitively so correction/forgetting invalidates derived data
// even after a crash or when a source is changed by another foreground process.
type Dependency struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Revision string `json:"revision"`
}

func ValidateDependencies(deps []Dependency) error {
	if len(deps) > 16 {
		return errors.New("at most sixteen knowledge dependencies are supported")
	}
	seen := map[string]bool{}
	for _, d := range deps {
		if seen[d.Kind+":"+d.ID] || d.Kind != "memory" && d.Kind != "note" && d.Kind != "skill" || len(d.Revision) != 64 {
			return errors.New("invalid knowledge dependency")
		}
		if _, err := hex.DecodeString(d.Revision); err != nil {
			return errors.New("invalid dependency revision")
		}
		if d.Kind == "memory" {
			if !strings.HasPrefix(d.ID, "mem-") || len(d.ID) != 28 {
				return errors.New("invalid memory dependency")
			}
		} else if !validID(d.Kind, d.ID) {
			return errors.New("invalid knowledge dependency ID")
		}
		seen[d.Kind+":"+d.ID] = true
	}
	return nil
}

func (s Store) dependencySource(kind, id, scope string, seen map[string]bool) (string, string, error) {
	if kind == "memory" {
		store, err := memory.Open(filepath.Dir(filepath.Dir(s.root)))
		if err != nil {
			return "", "", err
		}
		r, err := store.Inspect(id)
		if err != nil {
			return "", "", err
		}
		if r.GoalID != "" && r.GoalID != scope || !r.Recallable() || !r.ExpiresAt.IsZero() && !r.ExpiresAt.After(time.Now()) {
			return "", "", errors.New("memory source is outside scope or no longer eligible")
		}
		return r.Revision(), r.Text, nil
	}
	if seen[kind+":"+id] || len(seen) >= 32 {
		return "", "", errors.New("cyclic or excessive derived knowledge")
	}
	seen[kind+":"+id] = true
	defer delete(seen, kind+":"+id)
	d, err := s.loadRaw(kind, id)
	if err != nil {
		return "", "", err
	}
	if d.Policy != nil && d.Policy.SnoozedUntil.After(s.clock()) {
		return "", "", errors.New("source is snoozed")
	}
	if d.GoalID != "" && d.GoalID != scope || kind == "skill" && !d.Enabled {
		return "", "", errors.New("knowledge source is outside scope or disabled")
	}
	for _, dep := range d.Dependencies {
		revision, _, err := s.dependencySource(dep.Kind, dep.ID, d.GoalID, seen)
		if err != nil || revision != dep.Revision {
			return "", "", errors.New("a derived source changed, was forgotten or needs review")
		}
	}
	return d.SourceRevision(), d.Body, nil
}

func (s Store) dependencyIssue(d Document) string {
	if d.Policy != nil && d.Policy.SnoozedUntil.After(s.clock()) {
		return "Snoozed by you; unavailable for automatic recall until " + d.Policy.SnoozedUntil.Format(time.RFC3339)
	}
	for _, dep := range d.Dependencies {
		revision, _, err := s.dependencySource(dep.Kind, dep.ID, d.GoalID, map[string]bool{d.Kind + ":" + d.ID: true})
		if err != nil || revision != dep.Revision {
			return "Source " + dep.ID + " changed, was forgotten, is outside scope or needs review. Recreate this derived item from current evidence."
		}
	}
	return ""
}

func (s Store) CaptureDependencies(ids []string, scope string, excluded []string) ([]Dependency, []string, error) {
	if len(ids) == 0 || len(ids) > 8 {
		return nil, nil, errors.New("choose one to eight inspected knowledge sources")
	}
	release, err := s.lock(false)
	if err != nil {
		return nil, nil, err
	}
	defer release()
	deps := []Dependency{}
	previews := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] || slices.Contains(excluded, id) {
			return nil, nil, errors.New("source is repeated or excluded")
		}
		seen[id] = true
		kind := "skill"
		if strings.HasPrefix(id, "mem-") {
			kind = "memory"
		} else if strings.HasPrefix(id, "note-") {
			kind = "note"
		}
		revision, text, err := s.dependencySource(kind, id, scope, map[string]bool{})
		if err != nil {
			return nil, nil, err
		}
		if len(text) > 8192 {
			return nil, nil, errors.New("source is too large for bounded consolidation; select a smaller reviewed note")
		}
		deps = append(deps, Dependency{kind, id, revision})
		previews = append(previews, fmt.Sprintf("[%s] %s", id, text))
	}
	return deps, previews, nil
}

func (s Store) AddDerivedNote(title, body, scope string, deps []Dependency) (Document, error) {
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Document{}, err
	}
	return s.AddNoteWithIDAndDependencies("note-"+hex.EncodeToString(random[:]), title, body, scope, nil, deps)
}

func (s Store) CheckDependencies(scope string, deps []Dependency) error {
	if err := ValidateDependencies(deps); err != nil {
		return err
	}
	release, err := s.lock(false)
	if err != nil {
		return err
	}
	defer release()
	if issue := s.dependencyIssue(Document{GoalID: scope, Dependencies: deps}); issue != "" {
		return errors.New(issue)
	}
	return nil
}

// RecallPolicy is shared selection metadata; it does not alter source evidence.
type RecallPolicy = memory.RecallPolicy

func (s Store) UpdateRecallPolicy(id, revision string, policy RecallPolicy) (Document, error) {
	release, err := s.lock(false)
	if err != nil {
		return Document{}, err
	}
	defer release()
	d, err := s.load("note", id)
	if err != nil {
		return Document{}, err
	}
	if revision == "" || d.Revision() != revision {
		return Document{}, errors.New("note changed; reopen it before changing recall preferences")
	}
	if !policy.SnoozedUntil.IsZero() && (!policy.SnoozedUntil.After(s.clock()) || policy.SnoozedUntil.After(s.clock().Add(366*24*time.Hour))) {
		return Document{}, errors.New("snooze must end within the next year")
	}
	d.Policy = &policy
	d.Version = 2
	d.UpdatedAt = s.nextUpdate(d.UpdatedAt)
	return d, s.write(d)
}

func (d Document) SourceRevision() string {
	d.Policy = nil
	d.UpdatedAt = time.Time{}
	d.Version = Version
	return d.Revision()
}
