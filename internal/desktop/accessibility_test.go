package desktop

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type axRuntime struct {
	fakeRuntime
	tree      AccessibilityTree
	performed int
	err       error
	activated string
	afterRead func()
	readErr   error
}

func (r *axRuntime) ReadAccessibility(context.Context, Window) (AccessibilityTree, error) {
	if r.afterRead != nil {
		hook := r.afterRead
		r.afterRead = nil
		hook()
	}
	return r.tree, r.readErr
}
func (r *axRuntime) PerformAccessibility(_ context.Context, _ Window, _ AccessibilityTree, _ AccessibilityElement, _, _ string) error {
	r.performed++
	return r.err
}
func (r *axRuntime) Activate(_ context.Context, id string) error { r.activated = id; return nil }
func axFixture(t *testing.T) (*Controller, *Store, Session, *axRuntime) {
	t.Helper()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.Start(StartOptions{Apps: []Application{{BundleID: "dev.hcb.fixture"}}})
	if err != nil {
		t.Fatal(err)
	}
	runtime := &axRuntime{fakeRuntime: fakeRuntime{window: Window{Application: session.Apps[0], ID: 1, PID: 42, Width: 500, Height: 300}}, tree: AccessibilityTree{Title: "Fixture", Elements: []AccessibilityElement{{Role: "AXTextField", Label: "Draft", Value: "hello", Enabled: true, Actions: []string{"set_value"}, Path: []int{0}}}}}
	controller, err := NewController(store, runtime)
	if err != nil {
		t.Fatal(err)
	}
	return controller, store, session, runtime
}
func TestAccessibilityReviewedTargetAndSingleUse(t *testing.T) {
	c, _, s, r := axFixture(t)
	ctx := context.Background()
	snapshot, err := c.AccessibilitySnapshot(ctx, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	description, err := c.DescribeAccessibilityAction(ctx, s.ID, snapshot.ID, "e1", "set_value", "")
	if err != nil || !strings.Contains(description, "Return to approved dev.hcb.fixture") {
		t.Fatalf("description %q: %v", description, err)
	}
	if _, err = c.AccessibilityAction(ctx, s.ID, snapshot.ID, "e1", "set_value", ""); err != nil {
		t.Fatal(err)
	}
	if r.performed != 1 || r.activated != s.Apps[0].BundleID {
		t.Fatalf("runtime: %+v", r)
	}
	if _, err = c.AccessibilityAction(ctx, s.ID, snapshot.ID, "e1", "set_value", "retry"); err == nil || r.performed != 1 {
		t.Fatal("consumed reference was reused")
	}
}
func TestAccessibilityRejectsChangedTargets(t *testing.T) {
	for _, change := range []string{"tree", "control", "window", "geometry", "revision", "stopped", "expired", "ref", "action", "value"} {
		t.Run(change, func(t *testing.T) {
			c, store, s, r := axFixture(t)
			ctx := context.Background()
			snapshot, err := c.AccessibilitySnapshot(ctx, s.ID)
			if err != nil {
				t.Fatal(err)
			}
			ref, action, value := "e1", "set_value", "new"
			switch change {
			case "tree":
				r.tree.Title = "Different window content"
			case "control":
				r.tree.Elements[0].Label = "Different field"
			case "window":
				r.window.ID++
			case "geometry":
				r.window.Width++
			case "revision":
				_, _ = store.SetPaused(s.ID, true)
				_, _ = store.SetPaused(s.ID, false)
			case "stopped":
				_, _ = store.Stop(s.ID)
			case "expired":
				capture := c.accessibility[s.ID]
				capture.expires = time.Now().Add(-time.Second)
				c.accessibility[s.ID] = capture
			case "ref":
				ref = "e999"
			case "action":
				action = "press"
			case "value":
				value = strings.Repeat("x", 8193)
			}
			if _, err = c.AccessibilityAction(ctx, s.ID, snapshot.ID, ref, action, value); err == nil || r.performed != 0 {
				t.Fatalf("changed %s dispatched: %v", change, err)
			}
		})
	}
}
func TestAccessibilityUncertainActionPausesAcrossControllers(t *testing.T) {
	c, store, s, r := axFixture(t)
	ctx := context.Background()
	snapshot, err := c.AccessibilitySnapshot(ctx, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	r.err = ErrActionUncertain
	if _, err = c.AccessibilityAction(ctx, s.ID, snapshot.ID, "e1", "set_value", "new"); !errors.Is(err, ErrActionUncertain) {
		t.Fatal(err)
	}
	fresh, _ := NewController(store, r)
	if _, err = fresh.AccessibilitySnapshot(ctx, s.ID); !errors.Is(err, ErrPaused) {
		t.Fatalf("new controller bypassed pause: %v", err)
	}
	if _, err = c.AccessibilitySnapshot(ctx, s.ID); !errors.Is(err, ErrActionUncertain) {
		t.Fatal(err)
	}
	if r.performed != 1 {
		t.Fatal("action retried")
	}
}
func TestAccessibilitySensitiveAndPartialFields(t *testing.T) {
	for _, kind := range []string{"restricted", "partial", "nontext"} {
		t.Run(kind, func(t *testing.T) {
			c, _, s, r := axFixture(t)
			switch kind {
			case "restricted":
				r.tree.Restricted = true
			case "partial":
				r.tree.Elements[0].ValueTruncated = true
			case "nontext":
				r.tree.Elements[0].Role = "AXButton"
			}
			if _, err := c.AccessibilitySnapshot(context.Background(), s.ID); err == nil {
				t.Fatal("unsafe tree accepted")
			}
		})
	}
}
func TestReviewedDesktopPolicyDoesNotReviveAfterPause(t *testing.T) {
	c, store, s, _ := axFixture(t)
	c = c.Reviewed(PolicyDigest(s))
	ctx := context.Background()
	if _, err := c.AccessibilitySnapshot(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	// A separate process/controller writes the shared session store.
	other, err := Open(filepath.Dir(filepath.Dir(store.directory)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = other.SetPaused(s.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = other.SetPaused(s.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = c.AccessibilitySnapshot(ctx, s.ID); !errors.Is(err, ErrPolicyChanged) {
		t.Fatalf("old grant revived: %v", err)
	}
}

func TestAccessibilityReadWithdrawalAndFailureReturnNoContent(t *testing.T) {
	for _, kind := range []string{"paused-during-read", "read-failed"} {
		t.Run(kind, func(t *testing.T) {
			c, store, s, r := axFixture(t)
			if kind == "paused-during-read" {
				r.afterRead = func() { _, _ = store.SetPaused(s.ID, true) }
			} else {
				r.readErr = errors.New("app did not respond")
			}
			snapshot, err := c.AccessibilitySnapshot(context.Background(), s.ID)
			if err == nil || snapshot.ID != "" || len(snapshot.Elements) != 0 {
				t.Fatal("withdrawn/unreadable content escaped", snapshot, err)
			}
		})
	}
}

func TestDelayedReviewedResumeCannotUndoPrivateTakeover(t *testing.T) {
	_, store, s, _ := axFixture(t)
	paused, err := store.SetPaused(s.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	oldResume := PolicyDigest(paused)
	if _, err = store.SetPaused(s.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = store.SetPaused(s.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = store.SetPausedReviewed(s.ID, false, oldResume); !errors.Is(err, ErrPolicyChanged) {
		t.Fatalf("stale resume applied: %v", err)
	}
	current, _ := store.Get(s.ID)
	if !current.Paused {
		t.Fatal("private takeover undone")
	}
}
