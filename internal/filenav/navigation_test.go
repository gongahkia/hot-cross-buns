package filenav

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultHomeAndScopedPersistentRecency(t *testing.T) {
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	home, e = filepath.EvalSymlinks(home)
	if e != nil {
		t.Fatal(e)
	}
	s := Settings{}
	state, e := s.State("one", "")
	if e != nil || state.Root != home {
		t.Fatal(state, e)
	}
	root := t.TempDir()
	project := filepath.Join(root, "project")
	os.Mkdir(project, 0700)
	s.Root = root
	defaultState, e := s.State("new", filepath.Join(root, "old-snapshot"))
	if e != nil || defaultState.Working != root {
		t.Fatal("snapshot folder replaced default search root", defaultState, e)
	}
	state, e = s.Change("one", root, "focus", project)
	if e != nil || state.Working != project || len(state.RecentFolders) != 1 {
		t.Fatal(state, e)
	}
	other, _ := s.State("two", root)
	if other.Working != root {
		t.Fatal("folder leaked to another chat")
	}
	if _, e = s.Change("one", root, "focus", t.TempDir()); e == nil {
		t.Fatal("focus escaped search root")
	}
	for i := 0; i < 2; i++ {
		if _, e = s.Change("one", root, "recent-file", filepath.Join(project, "file.go")); e != nil {
			t.Fatal(e)
		}
	}
	state, _ = s.State("one", root)
	if len(state.RecentFiles) != 1 {
		t.Fatal("recency duplicated file")
	}
}
