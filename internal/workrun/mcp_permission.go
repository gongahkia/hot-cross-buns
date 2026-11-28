package workrun

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
)

type mcpPermission struct {
	ctx    context.Context
	store  mcpaccess.Store
	policy mcpaccess.Policy
	review mcpaccess.Review
	choose func(context.Context, mcpaccess.Review) (string, error)
	choice string
}

func (t *chatMCP) permissionGate(ctx context.Context, review mcpaccess.Review) (*mcpPermission, error) {
	if t.request.ApproveMCPCall == nil {
		return nil, nil
	}
	store, e := mcpaccess.Open(t.request.StateDir)
	if e != nil {
		return nil, e
	}
	p, e := store.Get()
	if e != nil {
		return nil, e
	}
	return &mcpPermission{ctx: ctx, store: store, policy: p, review: review, choose: t.request.ApproveMCPCall}, nil
}
func (g *mcpPermission) approve() (bool, error) {
	if g.policy.Allows(g.review.Connection) {
		return true, nil
	}
	choice, e := g.choose(g.ctx, g.review)
	if e != nil {
		return false, e
	}
	if choice == "deny" {
		return false, nil
	}
	if !mcpaccess.ValidChoice(choice) {
		return false, errors.New("invalid MCP permission choice")
	}
	g.choice = choice
	return true, nil
}
func withMCPPermission(g *mcpPermission, call func() (json.RawMessage, error)) (json.RawMessage, error) {
	if g == nil {
		return call()
	}
	result, e := g.store.Apply(g.ctx, g.policy.Revision, g.review.Connection, g.choice, func() (any, error) { return call() })
	if e != nil {
		return nil, e
	}
	raw, ok := result.(json.RawMessage)
	if !ok {
		return nil, errors.New("invalid MCP result")
	}
	return raw, nil
}
