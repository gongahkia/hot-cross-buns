package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
)

// Context describes the reviewed meaning and applicability of an exact source
// statement. It is reference metadata, never a tool grant or evidence of truth.
type Context struct {
	Why        string    `json:"why"`
	Importance string    `json:"importance"`
	State      string    `json:"state"`
	Entity     string    `json:"entity,omitempty"`
	AppliesTo  []string  `json:"applies_to,omitempty"`
	ValidFrom  time.Time `json:"valid_from,omitzero"`
	ValidUntil time.Time `json:"valid_until,omitzero"`
	Timezone   string    `json:"timezone,omitempty"`
}

type RecallPolicy struct {
	Pinned       bool      `json:"pinned,omitempty"`
	SnoozedUntil time.Time `json:"snoozed_until,omitzero"`
}

func (c *Context) Validate() error {
	if c == nil {
		return nil
	}
	if strings.TrimSpace(c.Why) == "" || len(c.Why) > 512 || !slices.Contains([]string{"constraint", "useful", "incidental"}, c.Importance) || !slices.Contains([]string{"current", "planned", "occurred", "cancelled", "historical"}, c.State) || len(c.Entity) > 128 || len(c.AppliesTo) > 8 {
		return errors.New("invalid memory significance or temporal context")
	}
	if !c.ValidFrom.IsZero() && !c.ValidUntil.IsZero() && !c.ValidUntil.After(c.ValidFrom) {
		return errors.New("memory validity end must follow its start")
	}
	if c.Timezone != "" {
		if _, err := time.LoadLocation(c.Timezone); err != nil {
			return errors.New("choose an IANA timezone for memory context")
		}
	}
	for _, term := range c.AppliesTo {
		if len(strings.TrimSpace(term)) < 2 || len(term) > 80 || strings.ContainsAny(term, "\x00\r\n") {
			return errors.New("invalid memory applicability term")
		}
	}
	if strings.ContainsRune(c.Why+c.Entity, 0) {
		return errors.New("invalid memory context text")
	}
	return nil
}

func (r Record) Revision() string {
	r.ConceptID = ""
	r.RecallIssue = ""
	r.ReviewAfter = time.Time{}
	r.SourceStatus = ""
	r.MatchedTerms = nil
	r.MatchScope = ""
	r.MatchMethod = ""
	data, _ := json.Marshal(r)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s Store) annotateContext(records []Record) {
	for i := range records {
		r := &records[i]
		if r.RecallIssue != "" {
			continue
		}
		switch {
		case r.Policy != nil && r.Policy.SnoozedUntil.After(s.clock()):
			r.RecallIssue = "Snoozed by you; excluded from automatic recall until " + r.Policy.SnoozedUntil.Format(time.RFC3339)
		case r.Context != nil && !r.Context.ValidFrom.IsZero() && r.Context.ValidFrom.After(s.clock()):
			r.RecallIssue = "This context is not yet applicable; inspect its validity interval."
		case r.Context != nil && !r.Context.ValidUntil.IsZero() && !r.Context.ValidUntil.After(s.clock()):
			r.RecallIssue = "This context's validity interval ended; it is retained as historical evidence, not a current fact."
		case r.Context != nil && slices.Contains([]string{"occurred", "cancelled", "historical"}, r.Context.State):
			r.RecallIssue = "Historical or cancelled context; inspect it explicitly rather than treating it as a current fact."
		}
	}
}

func (r Record) Applies(query string) bool {
	if r.Context == nil || len(r.Context.AppliesTo) == 0 {
		return true
	}
	words := tokenize(query)
	for _, term := range r.Context.AppliesTo {
		for token := range tokenize(term) {
			if words[token] {
				return true
			}
		}
	}
	return false
}

// UpdatePolicy changes future selection only. It never reconfirms the fact or
// clears a conflict, withdrawal, source warning or expiry.
func (s Store) UpdatePolicy(id, revision string, policy RecallPolicy) (Record, error) {
	release, err := s.lock()
	if err != nil {
		return Record{}, err
	}
	defer release()
	r, err := s.loadUnlocked(id)
	if err != nil {
		return Record{}, err
	}
	if revision == "" || r.UpdatedAt.Format(time.RFC3339Nano) != revision {
		return Record{}, errors.New("memory changed; reopen it before changing recall preferences")
	}
	if !policy.SnoozedUntil.IsZero() && (!policy.SnoozedUntil.After(s.clock()) || policy.SnoozedUntil.After(s.clock().Add(366*24*time.Hour))) {
		return Record{}, errors.New("snooze must end within the next year")
	}
	r.Policy = &policy
	r.Version = 2
	r.UpdatedAt = s.nextUpdate(r.UpdatedAt)
	return r, s.write(r, false)
}
