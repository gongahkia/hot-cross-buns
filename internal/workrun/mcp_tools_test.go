package workrun

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type mcpAppFixture struct {
	appControllerFixture
	session *mcpSessionFixture
	opens   int
	issue   error
}

func (f *mcpAppFixture) OpenMCP(context.Context, string, string) (MCPConnection, MCPIdentity, error) {
	f.opens++
	return f.session, MCPIdentity{Repository: "/project", Hash: "reviewed-bundle", Server: "sagasu"}, f.issue
}

type mcpSessionFixture struct {
	calls  []string
	closed int
	issue  error
}

func (f *mcpSessionFixture) Tools() []mcp.RemoteTool {
	return []mcp.RemoteTool{{Name: "list_bookings", InputSchema: json.RawMessage(`{"type":"object"}`), Annotations: json.RawMessage(`{"readOnlyHint":true}`)}, {Name: "wait_operation", InputSchema: json.RawMessage(`{"type":"object"}`), Annotations: json.RawMessage(`{"readOnlyHint":true}`)}, {Name: "book_room", InputSchema: json.RawMessage(`{"type":"object"}`)}}
}
func (f *mcpSessionFixture) Call(_ context.Context, name string, _ json.RawMessage) (json.RawMessage, error) {
	f.calls = append(f.calls, name)
	return json.RawMessage(`{"content":[{"type":"text","text":"live result"}]}`), f.issue
}
func (f *mcpSessionFixture) Close() error { f.closed++; return nil }
func mcpArgs(tool string) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"operation": "call", "server": "sagasu", "tool": tool, "arguments": map[string]any{"room": "one"}})
	return b
}
func TestForegroundMCPReadsAndPollsWithinOneNormalChatSession(t *testing.T) {
	app := &mcpAppFixture{session: &mcpSessionFixture{}}
	model := &scriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "discover", Name: "hot_cross_buns_mcp", Arguments: json.RawMessage(`{"operation":"discover","server":"sagasu"}`)}}}, {ToolCalls: []agent.ToolCall{{ID: "read", Name: "hot_cross_buns_mcp", Arguments: mcpArgs("list_bookings")}}}, {ToolCalls: []agent.ToolCall{{ID: "poll", Name: "hot_cross_buns_mcp", Arguments: mcpArgs("wait_operation")}}}, {Text: "Live booking result."}}}
	reviews := 0
	_, e := (Executor{App: app, Model: model, StateDir: t.TempDir()}).Execute(context.Background(), Request{ForegroundApp: true, SourcePath: t.TempDir(), Mode: action.Inspect, Contract: artifact.InspectionContract(), Objective: "List upcoming bookings", DisableDelegation: true, MaxSteps: 6, ApproveAppChange: func(_ context.Context, preview any) (bool, error) {
		reviews++
		v := preview.(map[string]any)
		if v["arguments"] == nil || v["connection"] == nil {
			t.Fatal("approval omitted binding")
		}
		return true, nil
	}})
	if e != nil || reviews != 2 || app.opens != 1 || len(app.session.calls) != 2 || app.session.closed != 1 {
		t.Fatalf("MCP normal chat read/poll failed: %v reviews=%d opens=%d calls=%v closed=%d", e, reviews, app.opens, app.session.calls, app.session.closed)
	}
}

type mcpAttempt struct{ records []action.Record }

func (a *mcpAttempt) Finish(r action.Record) error { a.records = append(a.records, r); return nil }
func (a *mcpAttempt) Close() error                 { return nil }
func TestMCPMutationsRequireModeFreshApprovalAndReceipts(t *testing.T) {
	for _, test := range []struct {
		name     string
		mode     action.Mode
		policy   action.Disposition
		decision action.Decision
		calls    int
	}{{"inspect", action.Inspect, action.Forbid, action.Allow, 0}, {"draft", action.Draft, action.Propose, action.Allow, 0}, {"denied", action.Act, action.Approve, action.Deny, 0}, {"approved", action.Act, action.Approve, action.Allow, 1}} {
		t.Run(test.name, func(t *testing.T) {
			app := &mcpAppFixture{session: &mcpSessionFixture{}}
			attempt := &mcpAttempt{}
			approvals := 0
			tool := newChatMCP(app, Request{ForegroundApp: true, Mode: test.mode, Contract: artifact.Contract{ExternalActions: test.policy}, ApproveAction: func(_ context.Context, p action.Proposal) (action.Decision, error) {
				approvals++
				if !strings.Contains(p.Preview, "book_room") || p.PayloadSHA256 == "" {
					t.Fatal("unbound review")
				}
				return test.decision, nil
			}}, tools.ConnectorPolicy{BeginAction: func(action.Proposal) (tools.ActionAttempt, error) { return attempt, nil }})
			defer tool.Close()
			_, e := tool.Execute(context.Background(), mcpArgs("book_room"))
			if test.mode == action.Inspect && e == nil {
				t.Fatal("inspect allowed an unknown/mutating MCP tool")
			}
			if len(app.session.calls) != test.calls {
				t.Fatal("incorrect mutation dispatch", app.session.calls, e)
			}
			if test.calls == 1 && (approvals != 1 || len(attempt.records) != 1 || attempt.records[0].Status != action.Executed || attempt.records[0].ResponseSHA256 == "") {
				t.Fatal("missing exact review/evidence")
			}
		})
	}
}
func TestMCPReadDeclineAndSetupFailureUseExistingLocalAgentPath(t *testing.T) {
	app := &mcpAppFixture{session: &mcpSessionFixture{}}
	tool := newChatMCP(app, Request{ForegroundApp: true, ApproveAppChange: func(context.Context, any) (bool, error) { return false, nil }}, tools.ConnectorPolicy{})
	defer tool.Close()
	result, e := tool.Execute(context.Background(), mcpArgs("list_bookings"))
	if e != nil || len(app.session.calls) != 0 || !strings.Contains(result.Content, "declined") {
		t.Fatal("declined read dispatched", e)
	}
	broken := &mcpAppFixture{issue: errors.New("interpreter missing")}
	repair := newChatMCP(broken, Request{ForegroundApp: true, ExternalAgents: []cliagent.Config{{Kind: "codex"}}}, tools.ConnectorPolicy{})
	_, e = repair.Execute(context.Background(), mcpArgs("list_bookings"))
	if e == nil || !strings.Contains(e.Error(), "cli_codex") || !strings.Contains(e.Error(), "start_agent") || !strings.Contains(e.Error(), "request_access") {
		t.Fatal("failure lacks bounded local-agent repair path", e)
	}
	for _, r := range []Request{{}, {ForegroundApp: true, ScheduledJobID: "job"}} {
		if newChatMCP(app, r, tools.ConnectorPolicy{}) != nil {
			t.Fatal("foreground MCP leaked to an unattended run")
		}
	}
}

func TestMCPStartupFailureCanDelegateDiagnosisToConfiguredCodex(t *testing.T) {
	if _, e := sandbox.StrictAvailability(); e != nil {
		t.Skip(e)
	}
	script, e := os.ReadFile("../cliagent/testdata/codex_rpc.sh")
	if e != nil {
		t.Fatal(e)
	}
	exe := filepath.Join(t.TempDir(), "codex-fixture")
	if e = os.WriteFile(exe, script, 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("FIXTURE_API_KEY", "synthetic-key")
	app := &mcpAppFixture{issue: errors.New("MCP interpreter is missing")}
	model := &scriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "discover", Name: "hot_cross_buns_mcp", Arguments: json.RawMessage(`{"operation":"discover","server":"sagasu"}`)}}}, {ToolCalls: []agent.ToolCall{{ID: "repair", Name: "start_agent", Arguments: json.RawMessage(`{"agent":"cli_codex","continue":"","task":"read-only fixture: Diagnose the local MCP setup failure read-only. Do not install, change files, or read credentials."}`)}}}, {ToolCalls: []agent.ToolCall{{ID: "await", Name: "await_agent", Arguments: json.RawMessage(`{"id":"subagent-001"}`)}}}, {Text: "Diagnosis completed."}, {Text: "Diagnosis completed; no uncertain action was replayed."}}}
	out, e := (Executor{App: app, Model: model, StateDir: t.TempDir()}).Execute(context.Background(), Request{ForegroundApp: true, SourcePath: t.TempDir(), Mode: action.Inspect, Contract: artifact.InspectionContract(), Objective: "Diagnose the MCP connection failure using configured Codex", ExternalAgents: []cliagent.Config{{Kind: "codex", Executable: exe, APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10}}, MaxSteps: 8})
	if e != nil {
		t.Fatal(e)
	}
	if len(out.Manifest.Subagents) != 1 || out.Manifest.Subagents[0].Agent != "cli_codex" || out.Manifest.Subagents[0].Status != "completed" {
		t.Fatalf("configured CLI repair diagnosis was not completed: %#v", out.Manifest.Subagents)
	}
}

func TestMCPRepairCanSwitchFromBlockedCopilotToConfiguredCodex(t *testing.T) {
	if _, err := sandbox.StrictAvailability(); err != nil {
		t.Skip(err)
	}
	directory := t.TempDir()
	copilot := filepath.Join(directory, "copilot-fixture")
	script := "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"assistant.message\",\"data\":{\"content\":\"Blocked: local command execution is unavailable.\"}}' '{\"type\":\"result\",\"exitCode\":0}'\n"
	if err := os.WriteFile(copilot, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../cliagent/testdata/codex_rpc.sh")
	if err != nil {
		t.Fatal(err)
	}
	codex := filepath.Join(directory, "codex-fixture")
	if err = os.WriteFile(codex, data, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FIXTURE_API_KEY", "synthetic-key")
	app := &mcpAppFixture{issue: errors.New("MCP setup failure")}
	model := &scriptedModel{turns: []agent.Turn{
		{ToolCalls: []agent.ToolCall{{ID: "discover", Name: "hot_cross_buns_mcp", Arguments: json.RawMessage(`{"operation":"discover","server":"sagasu"}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "catalog", Name: "list_agents", Arguments: json.RawMessage(`{}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "copilot", Name: "start_agent", Arguments: json.RawMessage(`{"agent":"cli_copilot","continue":"","task":"Inspect local MCP setup read-only."}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "wait-copilot", Name: "await_agent", Arguments: json.RawMessage(`{"id":"subagent-001"}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "codex", Name: "start_agent", Arguments: json.RawMessage(`{"agent":"cli_codex","continue":"","task":"read-only fixture: Diagnose the MCP connection after Copilot could not execute local commands."}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "wait-codex", Name: "await_agent", Arguments: json.RawMessage(`{"id":"subagent-002"}`)}}},
		{Text: "Diagnosis completed using authorized Codex fallback."},
		{Text: "Diagnosis completed using authorized Codex fallback; no uncertain action was replayed."},
	}}
	out, err := (Executor{App: app, Model: model, StateDir: t.TempDir()}).Execute(context.Background(), Request{ForegroundApp: true, SourcePath: t.TempDir(), Mode: action.Inspect, Contract: artifact.InspectionContract(), Objective: "Diagnose the local MCP failure. If Copilot cannot do it, use configured Codex instead.", ExternalAgents: []cliagent.Config{{Kind: "copilot", Executable: copilot, APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10}, {Kind: "codex", Executable: codex, APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 10}}, MaxSteps: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Manifest.Subagents) != 2 || out.Manifest.Subagents[0].Agent != "cli_copilot" || out.Manifest.Subagents[1].Agent != "cli_codex" || out.Manifest.Subagents[1].Status != "completed" {
		t.Fatal("fallback path incomplete", out.Manifest.Subagents)
	}
	catalog := ""
	for _, message := range model.requests[2].Messages {
		catalog += message.Content
	}
	if !strings.Contains(catalog, "shell/command execution is disabled") || !strings.Contains(catalog, "Can run local diagnostic commands") {
		t.Fatal("planner cannot distinguish adapter capabilities")
	}
}

func TestMCPRevokedTrustDoesNotSuggestCLIPermissionBypass(t *testing.T) {
	tool := newChatMCP(&mcpAppFixture{issue: ErrMCPTrust}, Request{ForegroundApp: true, ExternalAgents: []cliagent.Config{{Kind: "codex"}}}, tools.ConnectorPolicy{})
	_, e := tool.Execute(context.Background(), mcpArgs("list_bookings"))
	if e == nil || !strings.Contains(e.Error(), "Respect revoked access") || strings.Contains(e.Error(), "start_agent") {
		t.Fatal("trust rejection suggested repair bypass", e)
	}
}

func TestMCPFailedReadReleasesSessionForRepairVerification(t *testing.T) {
	session := &mcpSessionFixture{issue: errors.New("temporary setup failure")}
	app := &mcpAppFixture{session: session}
	tool := newChatMCP(app, Request{ForegroundApp: true, ApproveAppChange: func(context.Context, any) (bool, error) { return true, nil }}, tools.ConnectorPolicy{})
	defer tool.Close()
	if _, e := tool.Execute(context.Background(), mcpArgs("list_bookings")); e == nil {
		t.Fatal("failed read claimed success")
	}
	if session.closed != 1 || len(tool.sessions) != 0 {
		t.Fatal("failed session was retained")
	}
	session.issue = nil
	if _, e := tool.Execute(context.Background(), json.RawMessage(`{"operation":"discover","server":"sagasu"}`)); e != nil || app.opens != 2 {
		t.Fatal("repair could not rediscover server", e, app.opens)
	}
}
