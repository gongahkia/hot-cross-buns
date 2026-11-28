package workrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
)

// AppController is the foreground application's narrow settings boundary.
// Implementations expose display-safe projections, never arbitrary commands,
// files, credentials, or configuration documents.
type AppController interface {
	Inspect(context.Context, AppQuery) (any, error)
	Prepare(context.Context, AppChange) (AppMutation, error)
}

type AppQuery struct {
	Query          string `json:"query,omitempty"`
	Page           int    `json:"page,omitempty"`
	ConversationID string `json:"-"`
	Topic          string `json:"topic"`
	ID             string `json:"id,omitempty"`
}

type AppChange struct {
	ConversationID string          `json:"-"`
	Summary        string          `json:"-"`
	Setting        string          `json:"setting"`
	Value          json.RawMessage `json:"value"`
}

type AppMutation struct {
	ScheduleReview *scheduleaccess.Review
	ApplySchedule  func(context.Context, string) (any, error)
	Summary        string
	Preview        any
	Review         bool
	AfterReply     bool
	AfterRun       bool
	// Apply revalidates any settings or targets captured by Prepare.
	Apply func(context.Context) (any, error)
}

// AppAgreement is a host-constructed review, never model-authored approval UI.
type AppAgreement struct {
	Title  string   `json:"title"`
	Action string   `json:"action"`
	Lines  []string `json:"agreement"`
}

type appTool struct {
	controller AppController
	request    Request
	write      bool
}

func applicationTools(controller AppController, request Request) []agent.Tool {
	if controller == nil || !request.ForegroundApp {
		return nil
	}
	return []agent.Tool{appTool{controller: controller, request: request}, appTool{controller: controller, request: request, write: true}}
}

func (t appTool) Definition() agent.ToolDefinition {
	if !t.write {
		return agent.ToolDefinition{Name: "hot_cross_buns_app_inspect", Description: "Read Hot Cross Buns's file search root, working and recent folders (topic folders), actual settings, available models, usage, data/retention, recovery, connections, outputs, terminal appearance/navigation, shortcuts, voice preferences, memory sync or schedules (all saved tasks in this profile) and this chat's followups. Schedules supports optional id, query (title/id filter), and page (50 tasks per page); inspect the exact id to read its full prompt and expected_digest. Use before answering current-state questions or preparing changes. For feedback such as 'too noisy', inspect followups and identify the affected check; ask which check or what should change when unclear. Offer a scoped notification-condition, frequency or pause change through hot_cross_buns_app_update for review. A saved feedback rating alone does not alter checks. Report the actual mutation outcome. No secrets are returned. Optional id selects a retained output run or an exact follow-up.", Parameters: json.RawMessage(`{"type":"object","properties":{"topic":{"type":"string","enum":["settings","models","usage","data","recovery","connections","mcp","folders","outputs","terminal","shortcuts","voice","followups","schedules","memory_sync"]},"id":{"type":"string","maxLength":128},"query":{"type":"string","maxLength":256},"page":{"type":"integer","minimum":1,"maximum":1000}},"required":["topic"],"additionalProperties":false}`)}
	}
	return agent.ToolDefinition{Name: "hot_cross_buns_app_update", Description: "Change a Hot Cross Buns-owned setting only when the user asks. First inspect its topic: inspection returns current state and the exact update_help reference. Use only existing provider/model and action identities. connection_setup can create reviewed public connection configuration; mcp_setup connect can configure, trust and verify a specified project’s MCP server with one exact review in this chat; no workspace switch is needed. Inspect connections or mcp first; never pass tokens, secrets or secret-bearing command arguments. Changes affect future requests; running work, permissions and external-action approval remain host-controlled. Schedule and followup support conversational create/edit/pause/resume (schedules also cancel), explicit date windows, reviewed read/draft scope and routines. Inspect before edits; preserve expected_digest. Schedule date bounds must be structured, never only prompt text. Explain schedules in words. Never supply permission decisions in arguments, expose credentials/keys, or claim pending/declined updates succeeded. Respect a decline; do not propose the same action again without fresh user instructions. Higher-impact changes pause for exact review. For credential setup, local downloads and CLI login use their dedicated Models/Connections controls. Do not grant unrequested capabilities", Parameters: json.RawMessage(`{"type":"object","properties":{"setting":{"type":"string","enum":["work_effort","model","specialist_model","theme","terminal","retrieval","usage_limits","usage_pause","retention","connections","connection_setup","mcp_setup","folder","shortcuts","chat_learning","chat_history","voice","recovery","data_action","output_action","followup","schedule","memory_sync"]},"value":{"type":"object"}},"required":["setting","value"],"additionalProperties":false}`)}
}

// DecodeAppArguments also protects adapters from unknown keys and trailing
// values. Tool arguments are data and are never interpreted by a shell.
func DecodeAppArguments(data json.RawMessage, target any) error {
	if len(data) == 0 || len(data) > 16*1024 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return errors.New("app request must be a JSON object of at most 16 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("unexpected trailing app request data")
	}
	return nil
}

func (t appTool) Execute(ctx context.Context, args json.RawMessage) (agent.ToolResult, error) {
	if err := ctx.Err(); err != nil {
		return agent.ToolResult{}, err
	}
	var result any
	var err error
	if !t.write {
		var query AppQuery
		if err = DecodeAppArguments(args, &query); err != nil {
			return agent.ToolResult{}, err
		}
		query.ConversationID = t.request.ConversationID
		if t.request.OriginConversationID != "" {
			query.ConversationID = t.request.OriginConversationID
		}
		result, err = t.controller.Inspect(ctx, query)
		if value, ok := result.(map[string]any); ok && err == nil {
			copy := make(map[string]any, len(value)+1)
			for key, item := range value {
				copy[key] = item
			}
			copy["update_help"] = appUpdateHelp(query.Topic)
			result = copy
		} else if err == nil {
			result = map[string]any{"state": result, "update_help": appUpdateHelp(query.Topic)}
		}
	} else {
		var change AppChange
		if err = DecodeAppArguments(args, &change); err != nil {
			return agent.ToolResult{}, err
		}
		change.ConversationID = t.request.ConversationID
		if t.request.OriginConversationID != "" {
			change.ConversationID = t.request.OriginConversationID
		}
		prepared, prepareErr := t.controller.Prepare(ctx, change)
		if prepareErr != nil {
			return agent.ToolResult{}, prepareErr
		}
		if prepared.Apply == nil && prepared.ApplySchedule == nil {
			return agent.ToolResult{}, errors.New("app change has no validated operation")
		}
		change.Summary = prepared.Summary
		if prepared.ScheduleReview != nil {
			if prepared.ApplySchedule == nil || prepared.AfterReply || prepared.AfterRun {
				return agent.ToolResult{}, errors.New("invalid scheduling mutation")
			}
			choice := ""
			if prepared.Review {
				if t.request.ApproveScheduleChange == nil {
					return agent.ToolResult{}, errors.New("this schedule change requires review in the foreground app")
				}
				choice, err = t.request.ApproveScheduleChange(ctx, *prepared.ScheduleReview)
				if err != nil {
					return agent.ToolResult{}, err
				}
				if choice == "deny" {
					return appResult(map[string]any{"status": "declined", "setting": change.Setting})
				}
				if !scheduleaccess.ValidChoice(choice) {
					return agent.ToolResult{}, errors.New("invalid scheduling permission choice")
				}
			}
			result, err = prepared.ApplySchedule(ctx, choice)
			if err != nil {
				return agent.ToolResult{}, err
			}
			if t.request.OnAppChange != nil {
				t.request.OnAppChange(change)
			}
			return appResult(map[string]any{"status": "applied", "setting": change.Setting, "result": result})
		}
		if prepared.Review {
			if t.request.ApproveAppChange == nil {
				return agent.ToolResult{}, errors.New("this change requires review in the foreground Hot Cross Buns app")
			}
			approved, approvalErr := t.request.ApproveAppChange(ctx, prepared.Preview)
			if approvalErr != nil {
				return agent.ToolResult{}, approvalErr
			}
			if !approved {
				return appResult(map[string]any{"status": "declined", "setting": change.Setting})
			}
		}
		if err = ctx.Err(); err != nil {
			return agent.ToolResult{}, err
		}
		if prepared.AfterReply {
			if t.request.queueAppChange == nil {
				return agent.ToolResult{}, errors.New("this change requires a foreground reply lifecycle")
			}
			t.request.queueAppChange(change, prepared)
			return appResult(map[string]any{"status": "scheduled_after_reply", "setting": change.Setting, "preview": prepared.Preview, "note": "The host will apply this only after this response completes successfully. Do not claim it is already saved."})
		}
		if prepared.AfterRun {
			if t.request.AfterAppRun == nil {
				return agent.ToolResult{}, errors.New("this change needs the foreground app to finish its run first")
			}
			t.request.AfterAppRun(change, prepared)
			return appResult(map[string]any{"status": "scheduled_after_reply", "setting": change.Setting, "preview": prepared.Preview, "note": "The host will apply this after the current run releases its profile lease. Do not claim it is already saved."})
		}
		result, err = prepared.Apply(ctx)
		if err == nil {
			if t.request.OnAppChange != nil {
				t.request.OnAppChange(change)
			}
			result = map[string]any{"status": "applied", "setting": change.Setting, "result": result}
		}
	}
	if err != nil {
		return agent.ToolResult{}, err
	}
	return appResult(result)
}

func appResult(value any) (agent.ToolResult, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return agent.ToolResult{}, err
	}
	if len(data) > 128*1024 {
		return agent.ToolResult{}, errors.New("app result is too large; request a specific item")
	}
	return agent.ToolResult{Content: string(data)}, nil
}
