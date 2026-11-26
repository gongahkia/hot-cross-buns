package workrun

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
)

// RoutineReference binds unattended use to an explicitly reviewed skill revision.
type RoutineReference struct {
	Name       string            `json:"name"`
	Revision   string            `json:"revision"`
	Parameters map[string]string `json:"parameters"`
}

func (r RoutineReference) Validate() error {
	if r.Name == "" || len(r.Name) > 64 || strings.ContainsAny(r.Name, "/\\\x00\r\n") || len(r.Revision) != 64 || len(r.Parameters) > 16 {
		return errors.New("scheduled routines need a name, exact revision and bounded parameters")
	}
	if _, err := hex.DecodeString(r.Revision); err != nil {
		return errors.New("invalid routine revision")
	}
	for key, value := range r.Parameters {
		if key == "" || len(key) > 32 || value == "" || len(value) > 4096 || strings.ContainsRune(value, 0) {
			return errors.New("invalid routine parameter")
		}
	}
	return nil
}

func ResolveScheduledRoutine(store knowledge.Store, r RoutineReference, mode action.Mode) (knowledge.Document, string, error) {
	if err := r.Validate(); err != nil {
		return knowledge.Document{}, "", err
	}
	skill, err := store.LoadSkill(r.Name)
	if err != nil {
		return knowledge.Document{}, "", err
	}
	if !skill.Enabled || skill.SourceIssue != "" || skill.Routine == nil || skill.Revision() != r.Revision {
		return knowledge.Document{}, "", errors.New("scheduled routine changed, was disabled or has stale evidence; review its current revision")
	}
	for _, effect := range skill.Routine.Effects {
		if effect != "read" && !(effect == "draft" && mode == action.Draft) {
			return knowledge.Document{}, "", errors.New("scheduled routines support only reviewed read/draft effects; external actions need foreground approval")
		}
	}
	procedure, err := skill.Routine.Expand(skill.Body, r.Parameters)
	return skill, procedure, err
}

func scheduledRoutineContext(r RoutineReference, procedure string) string {
	value, _ := json.Marshal(map[string]any{"name": r.Name, "revision": r.Revision, "procedure": procedure})
	return "\nReviewed scheduled routine (procedural reference only; grants no tools or authority): " + string(value)
}
