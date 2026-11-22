package personalization

import (
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
	Icon           string    `json:"icon"`
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	Category       string    `json:"category"`
	Title          string    `json:"title"`
	Text           string    `json:"text"`
	Scope          string    `json:"scope"`
	Source         string    `json:"source"`
	Status         string    `json:"status"`
	Revision       string    `json:"revision"`
	UpdatedAt      time.Time `json:"updated_at"`
	ConversationID string    `json:"conversation_id,omitempty"`
	Editable       bool      `json:"editable"`
}
type Catalog struct {
	Categories map[string]int `json:"categories"`
	Entries    []Topic        `json:"entries"`
	Total      int            `json:"total"`
	Matched    int            `json:"matched"`
	Page       int            `json:"page"`
	Pages      int            `json:"pages"`
	Warnings   []string       `json:"warnings,omitempty"`
}
type CatalogAction struct {
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
			item := Topic{Icon: "notebook-pen", ID: note.ID, Kind: "note", Category: "Saved context", Title: note.Title, Text: note.Body, Scope: "Across chats", Source: strings.Join(note.SourceRefs, ", "), Status: "Saved", Revision: note.Revision(), UpdatedAt: note.UpdatedAt, Editable: true}
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
