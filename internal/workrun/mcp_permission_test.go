package workrun

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	"strings"
	"testing"
)

func TestMCPAlwaysAllowsReadsAndJournaledActionsButKeepsModeAndRevocation(t *testing.T) {
	state := t.TempDir()
	session := &mcpSessionFixture{}
	app := &mcpAppFixture{session: session}
	reviews := 0
	attempt := &mcpAttempt{}
	request := Request{StateDir: state, ForegroundApp: true, Mode: action.Act, Contract: artifact.Contract{ExternalActions: action.Approve}, ApproveMCPCall: func(context.Context, mcpaccess.Review) (string, error) { reviews++; return "always", nil }}
	policy := tools.ConnectorPolicy{BeginAction: func(action.Proposal) (tools.ActionAttempt, error) { return attempt, nil }}
	tool := newChatMCP(app, request, policy)
	if _, e := tool.Execute(context.Background(), mcpArgs("list_bookings")); e != nil {
		t.Fatal(e)
	}
	tool.Close()
	tool = newChatMCP(app, request, policy)
	defer tool.Close()
	if _, e := tool.Execute(context.Background(), mcpArgs("wait_operation")); e != nil {
		t.Fatal(e)
	}
	if _, e := tool.Execute(context.Background(), mcpArgs("book_room")); e != nil {
		t.Fatal(e)
	}
	if reviews != 1 || len(session.calls) != 3 || len(attempt.records) != 1 || attempt.records[0].Status != action.Executed {
		t.Fatal("always approval not reused or action not journaled", reviews, session.calls, attempt.records)
	}
	tool.request.Mode = action.Inspect
	if _, e := tool.Execute(context.Background(), mcpArgs("book_room")); e == nil {
		t.Fatal("grant bypassed inspect mode")
	}
	if len(session.calls) != 3 {
		t.Fatal("inspect dispatched a write")
	}
	store, _ := mcpaccess.Open(state)
	p, _ := store.Get()
	if e := store.Revoke(p.Revision, p.Grants[0]); e != nil {
		t.Fatal(e)
	}
	tool.request.ApproveMCPCall = func(context.Context, mcpaccess.Review) (string, error) { reviews++; return "deny", nil }
	out, e := tool.Execute(context.Background(), mcpArgs("wait_operation"))
	if e != nil || !strings.Contains(out.Content, "declined") || len(session.calls) != 3 || reviews != 2 {
		t.Fatal("revocation did not prompt and deny", out, e)
	}
}
