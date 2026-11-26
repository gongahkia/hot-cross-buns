package scheduleaccess

import (
	"context"
	"errors"
	"testing"
)

func TestSchedulingPermissionOnceAlwaysAndRevocation(t *testing.T) {
	state := t.TempDir()
	store, err := Open(state)
	if err != nil {
		t.Fatal(err)
	}
	policy, _ := store.Get()
	calls := 0
	apply := func() (any, error) { calls++; return "changed", nil }
	for _, choice := range []string{"", "full", "deny", "invalid"} {
		if _, err := store.Apply(context.Background(), policy.Revision, choice, apply); err == nil {
			t.Fatalf("unapproved choice %q ran", choice)
		}
	}
	if calls != 0 {
		t.Fatal("denied calls mutated state")
	}
	if _, err := store.Apply(context.Background(), policy.Revision, "once", apply); err != nil {
		t.Fatal(err)
	}
	after, _ := store.Get()
	if after.Always || after.Revision != policy.Revision {
		t.Fatal("allow once became persistent")
	}
	if _, err := store.Apply(context.Background(), policy.Revision, "always", apply); err != nil {
		t.Fatal(err)
	}
	reopened, _ := Open(state)
	allowed, _ := reopened.Get()
	if !allowed.Always || allowed.Revision == policy.Revision {
		t.Fatal("always did not persist")
	}
	if _, err := reopened.Apply(context.Background(), allowed.Revision, "", apply); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Set(allowed.Revision, false); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Apply(context.Background(), allowed.Revision, "once", apply); !errors.Is(err, ErrChanged) {
		t.Fatal("revoked pending action ran", err)
	}
	if calls != 3 {
		t.Fatal(calls)
	}
}

func TestCanceledSchedulingReviewDoesNotSaveGrantOrMutate(t *testing.T) {
	store, _ := Open(t.TempDir())
	policy, _ := store.Get()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.Apply(ctx, policy.Revision, "always", func() (any, error) { t.Fatal("cancelled action ran"); return nil, nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	after, _ := store.Get()
	if after != policy {
		t.Fatal("canceled permission persisted")
	}
}
