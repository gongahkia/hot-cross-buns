package cliagent

import (
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"strings"
	"testing"
)

func TestCopilotForwardsOnlyReviewedDirectoriesAndKeepsShellDisabled(t *testing.T) {
	cfg := Config{Kind: "copilot", LiveFiles: &sandbox.LiveFilesystem{Read: []string{"/approved/project", "/approved/notes"}}}
	args := cfg.Arguments(false)
	dirs := []string{}
	for i, arg := range args {
		if arg == "--add-dir" {
			dirs = append(dirs, args[i+1])
		}
		if strings.Contains(arg, "allow-all") || strings.Contains(arg, "shell") {
			t.Fatal("broadened Copilot permissions", args)
		}
	}
	if strings.Join(dirs, ",") != "/approved/project,/approved/notes" {
		t.Fatal("live paths not forwarded", args)
	}
	cfg.LiveFiles = nil
	if strings.Contains(strings.Join(cfg.Arguments(false), " "), "--add-dir") {
		t.Fatal("ungranted folder forwarded")
	}
}

func TestStreamsRequireTerminalSuccess(t *testing.T) {
	for _, test := range []struct {
		kind    string
		lines   []string
		summary string
	}{
		{"codex", []string{`{"type":"error","message":"retrying temporary transport failure"}`, `{"type":"thread.started"}`, `{"type":"item.completed","item":{"type":"agent_message","text":"done"}}`, `{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}`}, "done"},
		{"claude", []string{`{"type":"assistant"}`, `{"type":"result","subtype":"success","result":"done","usage":{"input_tokens":10,"output_tokens":2}}`}, "done"},
		{"pi", []string{`{"type":"tool_execution_end","result":{"content":[{"type":"text","text":"file"}]}}`, `{"type":"message_end","message":{"role":"user","content":"read notes"}}`, `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop","usage":{"input":10,"output":2}}}`, `{"type":"agent_end"}`, `{"type":"agent_settled","aborted":false}`}, "done"},
	} {
		t.Run(test.kind, func(t *testing.T) {
			s := streamState{}
			for i, line := range test.lines {
				if err := s.accept(test.kind, []byte(line)); err != nil {
					t.Fatal(err)
				}
				if i < len(test.lines)-1 && s.complete {
					t.Fatal("premature completion")
				}
			}
			if !s.complete || s.failed || s.summary != test.summary || s.usage.InputTokens != 10 {
				t.Fatalf("state: %#v", s)
			}
		})
	}
	s := streamState{}
	if err := s.accept("claude", []byte(`{"type":"result","subtype":"error_max_turns","is_error":true}`)); err != nil || !s.failed {
		t.Fatal("false success")
	}
	if err := s.accept("codex", []byte("not json")); err == nil {
		t.Fatal("malformed stream accepted")
	}
}
func TestAdapterArgumentsDisableNestedAgentsAndExtraTools(t *testing.T) {
	for _, kind := range []string{"codex", "claude", "pi"} {
		c := Config{Kind: kind}
		args := strings.Join(c.Arguments(false), " ")
		if strings.Contains(args, "dangerously") || strings.Contains(args, "bypassPermissions") {
			t.Fatal(args)
		}
		if kind == "codex" && !strings.Contains(args, "--disable multi_agent") {
			t.Fatal(args)
		}
		if kind == "pi" && strings.Contains(args, "bash") {
			t.Fatal(args)
		}
	}
}

func TestHeadlessAdapterTerminalContracts(t *testing.T) {
	for _, fixture := range []struct {
		kind  string
		lines []string
	}{
		{"opencode", []string{`{"type":"text","part":{"text":"done"}}`, `{"type":"step_finish","part":{"reason":"stop","tokens":{"input":10,"output":2}}}`}},
		{"gemini", []string{`{"type":"message","role":"assistant","content":"done","delta":false}`, `{"type":"result","status":"success","stats":{"input_tokens":10,"output_tokens":2}}`}},
		{"copilot", []string{`{"type":"assistant.message","data":{"content":"done"}}`, `{"type":"result","exitCode":0}`}},
	} {
		t.Run(fixture.kind, func(t *testing.T) {
			state := streamState{}
			if err := state.accept(fixture.kind, []byte(fixture.lines[0])); err != nil || state.complete {
				t.Fatal("assistant text mistaken for completion")
			}
			if err := state.accept(fixture.kind, []byte(fixture.lines[1])); err != nil || !state.complete || state.failed || state.summary != "done" {
				t.Fatalf("invalid terminal projection: %+v %v", state, err)
			}
		})
	}
	for _, fixture := range []struct{ kind, line string }{{"opencode", `{"type":"error"}`}, {"gemini", `{"type":"result","status":"error"}`}, {"copilot", `{"type":"session.error"}`}} {
		state := streamState{}
		if err := state.accept(fixture.kind, []byte(fixture.line)); err != nil || !state.failed {
			t.Errorf("%s hid an error", fixture.kind)
		}
		terminal := map[string]string{"opencode": `{"type":"step_finish","part":{"reason":"stop"}}`, "gemini": `{"type":"result","status":"success"}`, "copilot": `{"type":"result","exitCode":0}`}
		if err := state.accept(fixture.kind, []byte(terminal[fixture.kind])); err != nil || !state.failed {
			t.Errorf("%s cleared a previous error", fixture.kind)
		}
	}
}
