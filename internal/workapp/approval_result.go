package workapp

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func approvalMessage(interaction workrun.Interaction) message {
	preview, err := json.Marshal(interaction.Preview)
	if err != nil {
		preview = json.RawMessage(`{"error":"Preview could not be encoded"}`)
	}
	result := message{
		approvalID: interaction.ID,
		role:       "Approval",
		text:       fmt.Sprintf("%s #%d\n%s\nUse /approve or /deny.", interaction.Kind, interaction.ID, preview),
		result: &uisnapshot.Result{
			Kind: "approval", Title: "Review requested action", Tone: "warning",
			Fields:  []uisnapshot.Field{{Label: "Request", Value: fmt.Sprint(interaction.ID)}, {Label: "Action", Value: interaction.Kind}},
			Preview: preview, Footer: "/approve to allow · /deny to refuse",
		},
	}

	var mcpRead struct {
		Kind       string              `json:"kind"`
		Connection workrun.MCPIdentity `json:"connection"`
		Tool       string              `json:"tool"`
		Arguments  json.RawMessage     `json:"arguments"`
	}
	if interaction.Kind == "app_change" && json.Unmarshal(preview, &mcpRead) == nil && mcpRead.Kind == "mcp_read" {
		result.result.Title = "Read from " + mcpRead.Connection.Server
		result.result.Summary = "Allow this MCP tool call once."
		result.result.Fields = []uisnapshot.Field{{Label: "Server", Value: mcpRead.Connection.Server}, {Label: "Tool", Value: mcpRead.Tool}, {Label: "Project", Value: mcpRead.Connection.Repository}, {Label: "Arguments", Value: string(mcpRead.Arguments)}}
		result.result.Preview = nil
		result.result.Footer = "The server declares this tool read-only. Review its purpose and arguments; this grants no later calls."
	}
	if review, ok := interaction.Preview.(mcpaccess.Review); ok && interaction.Kind == "mcp_call" {
		result.result.Title = "Allow MCP call: " + review.Connection.Server
		result.result.Summary = "Allow this call once, or always allow all tools and actions from this trusted MCP server."
		result.result.Preview = nil
		result.result.Fields = []uisnapshot.Field{{Label: "Server", Value: review.Connection.Server}, {Label: "Tool", Value: review.Tool}, {Label: "Project", Value: review.Connection.Repository}, {Label: "Arguments", Value: string(review.Arguments)}}
		result.result.Footer = "Always allow includes reads and actions from this exact server in this project until revoked in Settings → Permissions. Changed configuration or executable needs fresh approval. Task mode, access boundaries and action receipts still apply."
	}
	var consolidation struct {
		Setting, Action, Effect string
		Title                   string `json:"proposed_title"`
		Summary                 string `json:"proposed_summary"`
		Sources                 []string
	}
	if interaction.Kind == "app_change" && json.Unmarshal(preview, &consolidation) == nil && consolidation.Setting == "memory" && consolidation.Action == "consolidate" {
		result.result.Title = "Review memory consolidation"
		result.result.Summary = consolidation.Title
		result.result.Preview = nil
		result.result.Sections = []uisnapshot.ResultSection{{Title: "Proposed summary", Lines: strings.Split(consolidation.Summary, "\n")}, {Title: "Original source statements", Lines: consolidation.Sources}}
		result.result.Lines = []string{consolidation.Effect}
	}
	var routine struct {
		Setting, Name, Description, Procedure, Effect string
		Parameters                                    map[string]string
		Sources, Effects                              []string
		Requests                                      int   `json:"max_additional_model_requests"`
		Tokens                                        int64 `json:"max_additional_reported_tokens"`
	}
	if interaction.Kind == "app_change" && json.Unmarshal(preview, &routine) == nil && routine.Setting == "routine" {
		result.result.Title = "Use saved routine"
		result.result.Summary = routine.Description
		result.result.Preview = nil
		result.result.Fields = []uisnapshot.Field{{Label: "Routine", Value: routine.Name}, {Label: "Source prerequisites", Value: strings.Join(routine.Sources, ", ")}, {Label: "Allowed future effects", Value: strings.Join(routine.Effects, ", ")}, {Label: "Additional limits", Value: fmt.Sprintf("%d model requests · %d reported tokens; existing lower task limits apply", routine.Requests, routine.Tokens)}}
		names := []string{}
		for name := range routine.Parameters {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			result.result.Fields = append(result.result.Fields, uisnapshot.Field{Label: name, Value: routine.Parameters[name]})
		}
		result.result.Sections = []uisnapshot.ResultSection{{Title: "Procedure", Lines: strings.Split(routine.Procedure, "\n")}}
		result.result.Lines = []string{routine.Effect}
		result.result.Footer = "Applies to this task only. File, account and computer access and external actions retain their separate reviews."
	}
	if agreement, ok := interaction.Preview.(workrun.AppAgreement); ok && interaction.Kind == "app_change" && agreement.Action != "" {
		result.result.Title = "Review follow-up"
		result.result.Summary = strings.ToUpper(agreement.Action[:1]) + agreement.Action[1:] + ": " + agreement.Title
		result.result.Preview = nil
		result.result.Fields = []uisnapshot.Field{{Label: "Request", Value: fmt.Sprint(interaction.ID)}}
		details := uisnapshot.ResultSection{Title: "Limits and delivery details", Collapsible: true}
		for _, line := range agreement.Lines {
			if label, value, ok := strings.Cut(line, ": "); ok {
				if label == "Limits" {
					details.Fields = append(details.Fields, uisnapshot.Field{Label: label, Value: value})
					continue
				}
				result.result.Fields = append(result.result.Fields, uisnapshot.Field{Label: label, Value: value})
			} else {
				details.Lines = append(details.Lines, line)
			}
		}
		result.result.Sections = []uisnapshot.ResultSection{details}
		result.result.Footer = "Sending or publishing still needs separate approval."
	}
	if review, ok := interaction.Preview.(workrun.WebAccessReview); ok && interaction.Kind == "web_access" {
		result.result.Title = "Review web research access"
		result.result.Summary = review.Reason
		result.result.Preview = nil
		scope := "Public HTTPS websites, including newly discovered sites"
		if review.Scope == "sites" {
			scope = strings.Join(review.Origins, ", ")
		}
		result.result.Fields = []uisnapshot.Field{{Label: "Web scope", Value: scope}, {Label: "Search service", Value: review.SearchProvider}, {Label: "Shared limits", Value: fmt.Sprintf("%d search requests within %d total web requests", review.MaxSearches, review.MaxRequests)}}
		result.result.Footer = review.Lifetime
	}
	if review, ok := interaction.Preview.(fileaccess.Review); ok && interaction.Kind == "file_access" {
		result.result.Title = "Allow filesystem access"
		result.result.Summary = review.Operation + ": " + review.Path
		result.result.Fields = append(result.result.Fields, uisnapshot.Field{Label: "Folder", Value: review.Folder}, uisnapshot.Field{Label: "Access", Value: review.Access})
		result.result.Lines = []string{review.Reason, review.FullAccessNotice}
		result.result.Footer = "Allow once: /approve once · Save folder: /approve always · Full filesystem: /approve full · Deny: /deny"
	}
	if review, ok := interaction.Preview.(scheduleaccess.Review); ok && interaction.Kind == "schedule_change" && review.Action != "" {
		result.result.Title = "Allow schedule change"
		result.result.Fields = []uisnapshot.Field{{Label: "Request", Value: fmt.Sprint(interaction.ID)}}
		result.result.Summary = strings.ToUpper(review.Action[:1]) + review.Action[1:] + ": " + review.Title
		result.result.Preview = nil
		result.result.Sections = []uisnapshot.ResultSection{{Title: "Scheduled task", Lines: review.Lines}}
		result.result.Footer = "Allow once applies to this change. Always allow scheduling lets HCB manage saved tasks until revoked in Settings → Permissions. Task execution keeps its separate file, account and action permissions."
	}
	return result
}
