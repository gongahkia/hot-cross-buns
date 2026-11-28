package mcpaccess

import (
	"context"
	"errors"
	"testing"
)

func TestMCPGrantPersistsOnlyForExactBundleAndRevokes(t *testing.T) {
	state := t.TempDir()
	s, e := Open(state)
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.Get()
	if e != nil {
		t.Fatal(e)
	}
	scope := Scope{Repository: "/project", Server: "sagasu", Hash: "bundle-one"}
	calls := 0
	call := func() (any, error) { calls++; return "result", nil }
	if _, e = s.Apply(context.Background(), p.Revision, scope, "", call); e == nil {
		t.Fatal("unapproved call ran")
	}
	if _, e = s.Apply(context.Background(), p.Revision, scope, "once", call); e != nil {
		t.Fatal(e)
	}
	p, _ = s.Get()
	if p.Allows(scope) {
		t.Fatal("once persisted")
	}
	if _, e = s.Apply(context.Background(), p.Revision, scope, "always", call); e != nil {
		t.Fatal(e)
	}
	reopened, _ := Open(state)
	p, _ = reopened.Get()
	if !p.Allows(scope) {
		t.Fatal("grant not persisted")
	}
	for _, other := range []Scope{{Repository: "/other", Server: scope.Server, Hash: scope.Hash}, {Repository: scope.Repository, Server: "other", Hash: scope.Hash}, {Repository: scope.Repository, Server: scope.Server, Hash: "changed"}} {
		if p.Allows(other) {
			t.Fatal("grant broadened", other)
		}
	}
	if _, e = reopened.Apply(context.Background(), p.Revision, scope, "", call); e != nil {
		t.Fatal(e)
	}
	if e = reopened.Revoke(p.Revision, scope); e != nil {
		t.Fatal(e)
	}
	if _, e = reopened.Apply(context.Background(), p.Revision, scope, "always", call); !errors.Is(e, ErrChanged) {
		t.Fatal("pending approval survived revocation", e)
	}
	p, _ = reopened.Get()
	if _, e = reopened.Apply(context.Background(), p.Revision, scope, "", call); e == nil {
		t.Fatal("revoked grant dispatched")
	}
	if calls != 3 {
		t.Fatal("unexpected execution count", calls)
	}
}
