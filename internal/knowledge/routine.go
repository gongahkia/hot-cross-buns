package knowledge

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type RoutineParameter struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Routine is metadata on an existing reviewed text skill. Source/effect labels
// describe prerequisites; they never activate tools, credentials or permissions.
type Routine struct {
	Parameters   []RoutineParameter `json:"parameters"`
	Sources      []string           `json:"sources"`
	Effects      []string           `json:"effects"`
	MaxRequests  int                `json:"max_requests"`
	MaxTokens    int64              `json:"max_tokens"`
	CapturedFrom string             `json:"captured_from,omitempty"`
}

var parameterName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
var parameterSlot = regexp.MustCompile(`\{\{([^{}]+)\}\}`)
var captureID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$`)

func (r Routine) Validate(body string) error {
	if r.CapturedFrom != "" && !captureID.MatchString(r.CapturedFrom) {
		return errors.New("invalid routine capture identity")
	}
	if len(r.Parameters) > 16 || len(r.Sources) > 8 || len(r.Effects) == 0 || len(r.Effects) > 8 || r.MaxRequests < 1 || r.MaxRequests > 128 || r.MaxTokens < 1000 || r.MaxTokens > 1000000 || len(r.CapturedFrom) > 96 {
		return errors.New("routine needs bounded parameters, sources, effect labels and request/token limits")
	}
	seen := map[string]bool{}
	for _, p := range r.Parameters {
		if !parameterName.MatchString(p.Name) || seen[p.Name] || strings.TrimSpace(p.Description) == "" || len(p.Description) > 512 || !utf8.ValidString(p.Description) || strings.ContainsRune(p.Description, 0) {
			return errors.New("invalid or duplicate routine parameter")
		}
		seen[p.Name] = true
	}
	slots := parameterSlot.FindAllStringSubmatch(body, -1)
	if len(slots) != strings.Count(body, "{{") || len(slots) != strings.Count(body, "}}") {
		return errors.New("routine parameter slots must use complete {{name}} pairs")
	}
	for _, slot := range slots {
		if !seen[slot[1]] {
			return fmt.Errorf("undeclared routine parameter %q", slot[1])
		}
	}
	for _, source := range r.Sources {
		if strings.TrimSpace(source) == "" || len(source) > 1024 || !utf8.ValidString(source) || strings.ContainsRune(source, 0) {
			return errors.New("invalid routine source hint")
		}
	}
	effects := map[string]bool{}
	for _, effect := range r.Effects {
		switch effect {
		case "read", "draft", "code", "filesystem", "browser", "desktop", "publish", "settings":
		default:
			return errors.New("invalid routine effect label")
		}
		if effects[effect] {
			return errors.New("duplicate routine effect label")
		}
		effects[effect] = true
	}
	return nil
}

func (r Routine) Expand(body string, values map[string]string) (string, error) {
	if err := r.Validate(body); err != nil {
		return "", err
	}
	if len(values) != len(r.Parameters) {
		return "", errors.New("provide exactly the routine's declared parameters")
	}
	for _, p := range r.Parameters {
		value, found := values[p.Name]
		if !found || strings.TrimSpace(value) == "" || len(value) > 4096 || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
			return "", fmt.Errorf("provide a bounded text value for %s", p.Name)
		}
	}
	// Expand only original slots; inserted values cannot introduce new slots.
	result := parameterSlot.ReplaceAllStringFunc(body, func(slot string) string { return values[slot[2:len(slot)-2]] })
	if len(result) > maxSkillBytes {
		return "", errors.New("expanded routine exceeds the procedure size limit")
	}
	return result, nil
}
