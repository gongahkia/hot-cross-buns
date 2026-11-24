package fileaccess

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func fixture(t *testing.T) (*Store, string) {
	t.Helper()
	state := t.TempDir()
	store, err := Open(state)
	if err != nil {
		t.Fatal(err)
	}
	folder, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return store, folder
}
func task(t *testing.T, s *Store, choice string) *Task {
	t.Helper()
	v, err := NewTask(s, false, func(context.Context, Review) (string, error) { return choice, nil })
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func TestLiveCRUDAndFreshHash(t *testing.T) {
	s, folder := fixture(t)
	calls := 0
	v, _ := NewTask(s, false, func(_ context.Context, r Review) (string, error) {
		calls++
		if r.Folder != folder || r.Access != "write" {
			t.Fatal(r)
		}
		return "once", nil
	})
	ctx := context.Background()
	path := filepath.Join(folder, "note.md")
	written, err := v.Execute(ctx, "write", path, "original", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	read, err := v.Execute(ctx, "read", path, "", "", "", "")
	if err != nil || read.Text != "original" || read.SHA256 != written.SHA256 {
		t.Fatal(read, err)
	}
	if _, err = v.Execute(ctx, "write", path, "new", "", "", ""); err == nil {
		t.Fatal("blind replacement")
	}
	if err = os.WriteFile(path, []byte("external edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = v.Execute(ctx, "write", path, "new", read.SHA256, "", ""); err == nil {
		t.Fatal("stale replacement")
	}
	fresh, _ := v.Execute(ctx, "read", path, "", "", "", "")
	if _, err = v.Execute(ctx, "write", path, "new", fresh.SHA256, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = v.Execute(ctx, "delete", path, "", fresh.SHA256, "", ""); err == nil {
		t.Fatal("stale delete")
	}
	fresh, _ = v.Execute(ctx, "read", path, "", "", "", "")
	if _, err = v.Execute(ctx, "delete", path, "", fresh.SHA256, "", ""); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(folder, "empty")
	if _, err = v.Execute(ctx, "mkdir", directory, "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = v.Execute(ctx, "delete", directory, "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("once did not cover the task", calls)
	}
	p, _ := s.Get()
	if len(p.Grants) != 0 || p.Full {
		t.Fatal("one-task grant persisted")
	}
}
func TestPersistentGrantsFullModeAndRevocation(t *testing.T) {
	for _, choice := range []string{"always", "full"} {
		t.Run(choice, func(t *testing.T) {
			s, folder := fixture(t)
			v := task(t, s, choice)
			ctx := context.Background()
			path := filepath.Join(folder, "a")
			if _, err := v.Execute(ctx, "write", path, "A", "", "", ""); err != nil {
				t.Fatal(err)
			}
			second, _ := NewTask(s, false, nil)
			if _, err := second.Execute(ctx, "read", path, "", "", "", ""); err != nil {
				t.Fatal("persistent access unavailable", err)
			}
			p, _ := s.Get()
			if choice == "full" && !p.Full || choice == "always" && len(p.Grants) != 1 {
				t.Fatal(p)
			}
			if _, err := s.RevokeAll(p.Revision); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(v.CheckPolicy(), ErrChanged) {
				t.Fatal("live task remained authorized")
			}
			if _, err := second.Execute(ctx, "read", path, "", "", "", ""); !errors.Is(err, ErrChanged) {
				t.Fatal("revoked read dispatched", err)
			}
			if _, err := s.SetFull(p.Revision, true); !errors.Is(err, ErrChanged) {
				t.Fatal("stale setting applied")
			}
		})
	}
}
func TestPermissionDecisionCancellationAndFolderReplacement(t *testing.T) {
	for _, kind := range []string{"deny", "cancel", "replace", "revoke"} {
		t.Run(kind, func(t *testing.T) {
			s, folder := fixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			v, _ := NewTask(s, false, func(_ context.Context, r Review) (string, error) {
				switch kind {
				case "deny":
					return "deny", nil
				case "cancel":
					cancel()
				case "replace":
					if err := os.Rename(folder, folder+"-old"); err != nil {
						t.Fatal(err)
					}
					if err := os.Mkdir(folder, 0700); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { os.RemoveAll(folder + "-old") })
				case "revoke":
					s.RevokeAll(r.Revision)
				}
				return "always", nil
			})
			if _, err := v.Execute(ctx, "write", filepath.Join(folder, "new"), "test", "", "", ""); err == nil {
				t.Fatal("stale/denied access dispatched")
			}
			if _, err := os.Stat(filepath.Join(folder, "new")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("file created without permission", err)
			}
		})
	}
}
func TestSymlinksProtectedRecordsAndReadOnlyBoundary(t *testing.T) {
	s, folder := fixture(t)
	v := task(t, s, "full")
	ctx := context.Background()
	protected := filepath.Join(s.directory, "private.json")
	os.WriteFile(protected, []byte("private"), 0600)
	link := filepath.Join(folder, "link")
	if err := os.Symlink(protected, link); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Execute(ctx, "read", link, "", "", "", ""); err == nil {
		t.Fatal("symlink escaped")
	}
	if _, err := v.Execute(ctx, "read", protected, "", "", "", ""); err == nil {
		t.Fatal("control record exposed")
	}
	readonly, _ := NewTask(s, true, func(context.Context, Review) (string, error) {
		t.Fatal("readonly requested mutation")
		return "full", nil
	})
	if _, err := readonly.Execute(ctx, "write", filepath.Join(folder, "bad"), "bad", "", "", ""); err == nil {
		t.Fatal("read-only task wrote")
	}
}
func TestReadGrantDoesNotAuthorizeWriteAndDirectoryDeleteIsEmptyOnly(t *testing.T) {
	s, folder := fixture(t)
	v := task(t, s, "always")
	ctx := context.Background()
	if _, err := v.Execute(ctx, "list", folder, "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	denied, _ := NewTask(s, false, nil)
	if _, err := denied.Execute(ctx, "write", filepath.Join(folder, "a"), "bad", "", "", ""); err == nil {
		t.Fatal("read grant widened")
	}
	writer := task(t, s, "once")
	directory := filepath.Join(folder, "filled")
	os.Mkdir(directory, 0700)
	os.WriteFile(filepath.Join(directory, "keep"), []byte("keep"), 0600)
	if _, err := writer.Execute(ctx, "delete", directory, "", "", "", ""); err == nil {
		t.Fatal("recursive deletion allowed")
	}
	if _, err := os.Stat(filepath.Join(directory, "keep")); err != nil {
		t.Fatal(err)
	}
}

func TestSymlinkedConfigFolderResolvesExactScopeBeforeReview(t *testing.T) {
	s, actual := fixture(t)
	links := t.TempDir()
	alias := filepath.Join(links, "nvim")
	if err := os.Symlink(actual, alias); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(actual, "init.lua"), []byte("return {}"), 0600)
	calls := 0
	v, _ := NewTask(s, true, func(_ context.Context, r Review) (string, error) {
		calls++
		if r.Folder != actual {
			t.Fatalf("review selected %q instead of actual config %q", r.Folder, actual)
		}
		return "once", nil
	})
	result, err := v.Execute(context.Background(), "list", alias, "", "", "", "")
	if err != nil || result.Path != actual {
		t.Fatal(result, err)
	}
	read, err := v.Execute(context.Background(), "read", filepath.Join(alias, "init.lua"), "", "", "", "")
	if err != nil || read.Text != "return {}" || calls != 1 {
		t.Fatal(read, err, calls)
	}
}
