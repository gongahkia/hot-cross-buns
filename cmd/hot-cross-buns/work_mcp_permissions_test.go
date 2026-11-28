package main

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
	"strconv"
	"testing"
)

func TestPermissionsScreenCanRevokeMCPGrant(t *testing.T) {
	c := followupControllerForTest(t)
	store, e := mcpaccess.Open(c.stateDir)
	if e != nil {
		t.Fatal(e)
	}
	p, _ := store.Get()
	scope := mcpaccess.Scope{Repository: "/project", Hash: "bundle", Server: "sagasu"}
	if _, e = store.Apply(context.Background(), p.Revision, scope, "always", func() (any, error) { return nil, nil }); e != nil {
		t.Fatal(e)
	}
	screen, e := permissionControl(context.Background(), c.stateDir, "status", nil)
	if e != nil {
		t.Fatal(e)
	}
	for _, a := range screen.Actions {
		if a.Action == "mcp-revoke" {
			if _, e = permissionControl(context.Background(), c.stateDir, a.Action, a.Args); e != nil {
				t.Fatal(e)
			}
			next, _ := store.Get()
			if next.Allows(scope) {
				t.Fatal("grant survived revocation")
			}
			if _, e = permissionControl(context.Background(), c.stateDir, a.Action, a.Args); e == nil {
				t.Fatal("stale revocation accepted")
			}
			if a.Args[0] != strconv.FormatUint(p.Revision+1, 10) {
				t.Fatal("incorrect revision")
			}
			return
		}
	}
	t.Fatal("MCP revocation missing from Permissions")
}
