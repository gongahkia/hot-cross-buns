package personalization

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/learning"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

type Topic struct {
	Related         []string               `json:"related,omitempty"`
	CanManageRecall bool                   `json:"can_manage_recall,omitempty"`
	WhySaved        string                 `json:"why_saved,omitempty"`
	Context         *memory.Context        `json:"memory_context,omitempty"`
	Policy          *memory.RecallPolicy   `json:"recall_policy,omitempty"`
	Dependencies    []knowledge.Dependency `json:"dependencies,omitempty"`
	Reviewable      bool                   `json:"reviewable,omitempty"`
	RecallIssue     string                 `json:"recall_issue,omitempty"`
	SourceQuote     string                 `json:"source_quote,omitempty"`
	Icon            string                 `json:"icon"`
	ID              string                 `json:"id"`
	Kind            string                 `json:"kind"`
	Category        string                 `json:"category"`
	Title           string                 `json:"title"`
	Text            string                 `json:"text"`
	Scope           string                 `json:"scope"`
	Source          string                 `json:"source"`
	Status          string                 `json:"status"`
	Revision        string                 `json:"revision"`
	UpdatedAt       time.Time              `json:"updated_at"`
	ConversationID  string                 `json:"conversation_id,omitempty"`
	Editable        bool                   `json:"editable"`
}
type Catalog struct {
	MarkdownFiles []MarkdownFile `json:"markdown_files,omitempty"`
	ExcludedIDs   []string       `json:"excluded_ids,omitempty"`
	Categories    map[string]int `json:"categories"`
	Entries       []Topic        `json:"entries"`
	Total         int            `json:"total"`
	Matched       int            `json:"matched"`
	Page          int            `json:"page"`
	Pages         int            `json:"pages"`
	Warnings      []string       `json:"warnings,omitempty"`
}
type CatalogAction struct {
	Until      string `json:"until,omitempty"`
	MemoryKind string `json:"memory_kind,omitempty"`
	Category   string `json:"category,omitempty"`
	RequestID  string `json:"request_id"`
	Action     string `json:"action"`
	ID         string `json:"id,omitempty"`
	Revision   string `json:"revision,omitempty"`
	Text       string `json:"text,omitempty"`
	Query      string `json:"query,omitempty"`
	Page       int    `json:"page,omitempty"`
}
type CatalogResult struct {
	RequestID string   `json:"request_id"`
	Catalog   *Catalog `json:"catalog,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// ReadCatalog projects owning stores without generating or persisting inferred personal traits.
func ReadCatalog(stateDir, query, category string, page int) (Catalog, error) {
	files, syncErr := SyncMarkdown(stateDir)
	result, err := readCatalog(stateDir, query, category, page, false)
	result.MarkdownFiles = files
	if syncErr != nil {
		result.Warnings = append(result.Warnings, "Markdown memory: "+syncErr.Error())
	}
	return result, err
}

func readCatalog(stateDir, query, category string, page int, all bool) (Catalog, error) {
	result := Catalog{Entries: []Topic{}, Categories: map[string]int{}}
	memories, err := memory.Open(stateDir)
	if err != nil {
		return result, err
	}
	records, err := memories.ListAll(true)
	if warning := memory.ReadWarning(err); warning != "" {
		result.Warnings = append(result.Warnings, warning)
	} else if err != nil {
		return result, err
	}
	var topics []Topic
	goalNames := map[string]string{}
	if goals, openErr := goal.Open(stateDir); openErr == nil {
		if records, listErr := goals.List(); listErr == nil {
			for _, record := range records {
				goalNames[record.ID] = record.Title
			}
		}
	}
	scopeName := func(id string) string {
		if title := goalNames[id]; title != "" {
			return "Goal · " + title
		}
		return "Goal · " + id
	}
	for _, record := range records {
		category := "About you"
		switch record.Kind {
		case "preference":
			category = "Preferences"
		case "note", "decision":
			category = "Personal context"
		}
		if memory.CanonicalSubject(record.Subject) == "profile.projects" || strings.HasPrefix(record.Subject, "project.") {
			category = "Projects and goals"
		}
		title := strings.ReplaceAll(strings.ReplaceAll(record.Subject, ".", " · "), "_", " ")
		if title == "" {
			title = strings.ToUpper(record.Kind[:1]) + record.Kind[1:]
		}
		status := "Active"
		if !record.Recallable() || !record.ExpiresAt.IsZero() && !record.ExpiresAt.After(time.Now()) {
			status = "Needs review"
		}
		memoryIcon := map[string]string{"fact": "brain", "preference": "lightbulb", "note": "notebook-pen", "decision": "list-checks"}[record.Kind]
		item := Topic{Icon: memoryIcon, ID: record.ID, Kind: "memory", Category: category, Title: title, Text: record.Text, Scope: "Across chats", Source: record.Source, Status: status, Revision: record.UpdatedAt.Format(time.RFC3339Nano), UpdatedAt: record.UpdatedAt, Editable: true}
		item.CanManageRecall = record.GoalID == ""
		item.Context = record.Context
		item.Policy = record.Policy
		item.RecallIssue = record.RecallIssue
		item.WhySaved = "Saved by you or from an eligible exact user statement"
		if record.Context != nil {
			item.WhySaved = record.Context.Why
		}
		if record.Origin != nil {
			item.SourceQuote = record.Origin.Quote
		}
		if record.GoalID != "" {
			item.Category = "Projects and goals"
			item.Scope = scopeName(record.GoalID)
			item.Editable = false
		}
		if record.Origin != nil {
			item.ConversationID = record.Origin.ConversationID
			item.Source = "From a chat · " + record.Origin.Basis
		}
		if record.RecallIssue != "" {
			item.Status = "Needs review"
			item.Source += " · " + record.RecallIssue
		}
		topics = append(topics, item)
	}
	notes, err := knowledge.Open(stateDir)
	if err != nil {
		result.Warnings = append(result.Warnings, "Saved notes unavailable: "+err.Error())
	} else {
		documents, readErr := notes.ListAllNotes()
		if readErr != nil {
			result.Warnings = append(result.Warnings, "Saved notes unavailable: "+readErr.Error())
		}
		for _, note := range documents {
			full, err := notes.LoadNote(note.ID)
			if err != nil {
				result.Warnings = append(result.Warnings, "A saved note could not be read")
				continue
			}
			note = full
			item := Topic{Icon: "notebook-pen", ID: note.ID, Kind: "note", Category: "Saved context", Title: note.Title, Text: note.Body, Scope: "Across chats", Source: strings.Join(note.SourceRefs, ", "), Status: "Saved", Revision: note.Revision(), UpdatedAt: note.UpdatedAt, Editable: true}
			item.CanManageRecall = note.GoalID == ""
			item.Dependencies = note.Dependencies
			item.Policy = note.Policy
			item.RecallIssue = note.SourceIssue
			item.WhySaved = "Saved reference material"
			if len(note.Dependencies) > 0 {
				item.WhySaved = "Reviewed consolidation derived from pinned source revisions"
			}
			if note.SourceIssue != "" {
				item.Editable = false
				item.Status = "Needs review"
				item.Text = "Derived or snoozed content is unavailable for recall. " + note.SourceIssue
			}
			if note.GoalID != "" {
				item.Category = "Projects and goals"
				item.Scope = scopeName(note.GoalID)
				item.Editable = false
			}
			topics = append(topics, item)
		}
	}
	lessons, err := learning.Open(stateDir)
	if err != nil {
		result.Warnings = append(result.Warnings, "Guidance unavailable: "+err.Error())
	} else {
		guidance, readErr := lessons.List()
		if readErr != nil {
			result.Warnings = append(result.Warnings, "Guidance unavailable: "+readErr.Error())
		}
		for _, record := range guidance {
			scope := "Across chats"
			if record.Scope.Kind == learning.Project {
				scope = record.Scope.Value
			}
			status := map[learning.Status]string{learning.Active: "Active", learning.Candidate: "Awaiting review", learning.Disabled: "Disabled", learning.Rejected: "Rejected"}[record.Status]
			topics = append(topics, Topic{Icon: "list-checks", ID: record.ID, Kind: "guidance", Category: "Guidance", Title: record.Key, Text: record.Content, Scope: scope, Source: string(record.Origin), Status: status, UpdatedAt: record.UpdatedAt, Revision: record.UpdatedAt.Format(time.RFC3339Nano)})
		}
	}

	candidates, candidateErr := memories.Candidates()
	if candidateErr != nil {
		result.Warnings = append(result.Warnings, "Memory proposals unavailable: "+candidateErr.Error())
	}
	for _, c := range candidates {
		text := c.Input.Quote
		status := "Awaiting review"
		if c.Status == "stale" {
			text = "Sources changed. Ask for a fresh significance proposal."
			status = "Stale proposal"
		}
		var related []string
		if c.Status == "pending" {
			for _, id := range c.Plan.MatchIDs {
				if r, err := memories.Inspect(id); err == nil && r.GoalID == c.Input.GoalID {
					related = append(related, "["+r.ID+"] "+r.Text)
				}
			}
		}
		topics = append(topics, Topic{Related: related, Icon: "lightbulb", ID: c.ID, Kind: "candidate", Category: "Suggestions", Title: c.Input.Subject, Text: text, Scope: contextScopeName(c.Input.GoalID), Source: "Current user statement · " + c.Input.RunID, SourceQuote: c.Input.Quote, WhySaved: c.Input.Context.Why, Context: c.Input.Context, Status: status, Revision: c.UpdatedAt.Format(time.RFC3339Nano), UpdatedAt: c.UpdatedAt, Reviewable: c.Status == "pending" && c.Input.GoalID == ""})
	}
	if notes.Root() != "" {
		if skills, err := notes.ListSkills(false); err == nil {
			for _, skill := range skills {
				d, err := notes.LoadSkill(skill.ID)
				if err != nil {
					continue
				}
				status := "Disabled"
				if d.Enabled {
					status = "Enabled"
				}
				text := d.Description
				if d.SourceIssue != "" {
					status = "Needs review"
					text = d.SourceIssue
				}
				topics = append(topics, Topic{Icon: "book-open", ID: d.ID, Kind: "routine", Category: "Routines", Title: d.Title, Text: text, Scope: "Across chats", Status: status, Revision: d.Revision(), UpdatedAt: d.UpdatedAt, Dependencies: d.Dependencies, RecallIssue: d.SourceIssue, WhySaved: "Reviewed reusable procedure; activation and access remain separate"})
			}
		}
	}
	sort.SliceStable(topics, func(i, j int) bool {
		if topics[i].UpdatedAt.Equal(topics[j].UpdatedAt) {
			return topics[i].ID < topics[j].ID
		}
		return topics[i].UpdatedAt.After(topics[j].UpdatedAt)
	})
	result.Total = len(topics)
	for _, topic := range topics {
		result.Categories[topic.Category]++
	}
	var matched []Topic
	terms := strings.Fields(strings.ToLower(query))
	for _, topic := range topics {
		if category != "" && topic.Category != category {
			continue
		}
		haystack := strings.ToLower(strings.Join([]string{topic.Title, topic.Text, topic.Category, topic.Scope, topic.Status, topic.Source}, " "))
		keep := true
		for _, term := range terms {
			if !strings.Contains(haystack, term) {
				keep = false
				break
			}
		}
		if keep {
			matched = append(matched, topic)
		}
	}
	if all {
		result.Entries = append(result.Entries, matched...)
		result.Total = len(matched)
		return result, nil
	}
	result.Matched = len(matched)
	result.Pages = max(1, (len(matched)+39)/40)
	result.Page = min(max(0, page), result.Pages-1)
	start := min(len(matched), result.Page*40)
	result.Entries = append(result.Entries, matched[start:min(start+40, len(matched))]...)
	return result, nil
}

func ApplyCatalog(stateDir string, action CatalogAction) CatalogResult {
	result := CatalogResult{RequestID: action.RequestID}
	if len(action.Query) > 512 || action.Page < 0 || action.Page > 100000 || len(action.Text) > 65536 {
		result.Error = "Memory request exceeds the supported limits."
		return result
	}
	if action.Action != "list" {
		if err := changeTopic(stateDir, action); err != nil {
			result.Error = err.Error()
			return result
		}
	}
	catalog, err := ReadCatalog(stateDir, action.Query, action.Category, action.Page)
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Catalog = &catalog
	}
	return result
}
func changeTopic(stateDir string, action CatalogAction) error {
	if action.Action == "add" {
		if action.ID != "" || action.Revision != "" || (action.MemoryKind != "fact" && action.MemoryKind != "preference" && action.MemoryKind != "note") || strings.TrimSpace(action.Text) == "" || len(action.Text) > 4096 {
			return errors.New("choose a personal memory type and enter up to 4096 bytes")
		}
		store, err := memory.Open(stateDir)
		if err != nil {
			return err
		}
		_, err = store.Add(action.MemoryKind, strings.TrimSpace(action.Text), "", "Added by you", time.Time{})
		return err
	}
	if action.Action == "accept" || action.Action == "reject" {
		store, err := memory.Open(stateDir)
		if err != nil {
			return err
		}
		candidates, err := store.Candidates()
		if err != nil {
			return err
		}
		for _, c := range candidates {
			if c.ID == action.ID && c.Input.GoalID != "" {
				return errors.New("review this proposal in its owning goal")
			}
		}
		_, err = store.ReviewCandidate(context.Background(), action.ID, action.Revision, action.Action)
		return err
	}
	if action.Action == "exclude" || action.Action == "include" {
		if strings.HasPrefix(action.ID, "mem-") {
			s, err := memory.Open(stateDir)
			if err != nil {
				return err
			}
			r, err := s.Load(action.ID)
			if err != nil {
				return err
			}
			if r.GoalID != "" || r.UpdatedAt.Format(time.RFC3339Nano) != action.Revision {
				return errors.New("memory changed or belongs to a goal")
			}
			return nil
		}
		if strings.HasPrefix(action.ID, "note-") {
			s, err := knowledge.Open(stateDir)
			if err != nil {
				return err
			}
			r, err := s.LoadNote(action.ID)
			if err != nil {
				return err
			}
			if r.GoalID != "" || r.Revision() != action.Revision {
				return errors.New("note changed or belongs to a goal")
			}
			return nil
		}
		return errors.New("choose a personal memory or saved note")
	}
	if action.Action == "pin" || action.Action == "unpin" || action.Action == "snooze" || action.Action == "unsnooze" {
		return changeRecallPolicy(stateDir, action)
	}
	if action.Action != "correct" && action.Action != "forget" {
		return errors.New("unsupported memory action")
	}
	if action.Revision == "" || action.Action == "correct" && strings.TrimSpace(action.Text) == "" {
		return errors.New("reopen the memory and provide its current revision and text")
	}
	if strings.HasPrefix(action.ID, "mem-") {
		store, err := memory.Open(stateDir)
		if err != nil {
			return err
		}
		record, err := store.Load(action.ID)
		if err != nil {
			return err
		}
		if record.GoalID != "" {
			return errors.New("open this goal's saved knowledge to change its scoped memory")
		}
		if action.Action == "forget" {
			return store.ForgetReviewed(record.ID, action.Revision)
		}
		_, err = store.CorrectReviewed(record.ID, action.Text, record.Source, action.Revision)
		return err
	}
	if strings.HasPrefix(action.ID, "note-") {
		store, err := knowledge.Open(stateDir)
		if err != nil {
			return err
		}
		_, err = store.ReviewNote(action.ID, "", action.Revision, action.Action, action.Text)
		return err
	}
	return errors.New("manage this saved guidance through the guidance controls")
}

func contextScopeName(goal string) string {
	if goal == "" {
		return "Across chats"
	}
	return "Goal · " + goal
}
func changeRecallPolicy(state string, a CatalogAction) error {
	var p memory.RecallPolicy
	var until time.Time
	var err error
	if a.Action == "snooze" {
		until, err = time.Parse(time.RFC3339, a.Until)
		if err != nil {
			return errors.New("choose an absolute snooze end time")
		}
	}
	if strings.HasPrefix(a.ID, "mem-") {
		s, err := memory.Open(state)
		if err != nil {
			return err
		}
		r, err := s.Load(a.ID)
		if err != nil {
			return err
		}
		if r.GoalID != "" {
			return errors.New("open the owning goal to manage this context")
		}
		if r.Policy != nil {
			p = *r.Policy
		}
		switch a.Action {
		case "pin":
			p.Pinned = true
		case "unpin":
			p.Pinned = false
		case "snooze":
			p.SnoozedUntil = until
		case "unsnooze":
			p.SnoozedUntil = time.Time{}
		}
		_, err = s.UpdatePolicy(a.ID, a.Revision, p)
		return err
	}
	s, err := knowledge.Open(state)
	if err != nil {
		return err
	}
	r, err := s.LoadNote(a.ID)
	if err != nil {
		return err
	}
	if r.GoalID != "" {
		return errors.New("open the owning goal to manage this note")
	}
	if r.Policy != nil {
		p = *r.Policy
	}
	switch a.Action {
	case "pin":
		p.Pinned = true
	case "unpin":
		p.Pinned = false
	case "snooze":
		p.SnoozedUntil = until
	case "unsnooze":
		p.SnoozedUntil = time.Time{}
	}
	_, err = s.UpdateRecallPolicy(a.ID, a.Revision, p)
	return err
}
