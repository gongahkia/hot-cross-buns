package fileaccess

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScheduledFolderGrantsAreReadOnlyRevisionBoundAndSeparateFromForeground(t *testing.T) {
	s, folder := fixture(t)
	policy, _ := s.Get()
	digest := strings.Repeat("a", 64)
	_, identity, _ := Folder(folder)
	policy, err := s.AddScheduled(policy.Revision, folder, identity, "job-one", digest)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Version != 2 {
		t.Fatal("older runtimes could misinterpret the new grant")
	}
	path := filepath.Join(folder, "note")
	if err := os.WriteFile(path, []byte("approved scheduled text"), 0600); err != nil {
		t.Fatal(err)
	}
	valid := true
	check := func() error {
		if !valid {
			return errors.New("job changed")
		}
		return nil
	}
	job, err := NewScheduledTask(s, "job-one", digest, check)
	if err != nil || job == nil {
		t.Fatal(job, err)
	}
	got, err := job.Execute(context.Background(), "read", path, "", "", "", "")
	if err != nil || got.Text != "approved scheduled text" {
		t.Fatal(got, err)
	}
	if _, err = job.Execute(context.Background(), "write", path, "changed", got.SHA256, "", ""); err == nil {
		t.Fatal("scheduled grant allowed a mutation")
	}
	foreground := task(t, s, "deny")
	if _, err = foreground.Execute(context.Background(), "read", path, "", "", "", ""); err == nil {
		t.Fatal("scheduled grant leaked into foreground")
	}
	for _, scope := range [][2]string{{"job-other", digest}, {"job-one", strings.Repeat("b", 64)}} {
		other, err := NewScheduledTask(s, scope[0], scope[1], check)
		if err != nil || other != nil {
			t.Fatal("foreign job/revision inherited the grant", other, err)
		}
	}
	policy, err = s.SetFull(policy.Revision, true)
	if err != nil {
		t.Fatal(err)
	}
	job, err = NewScheduledTask(s, "job-one", digest, check)
	if err != nil {
		t.Fatal(err)
	}
	otherFolder := t.TempDir()
	otherPath := filepath.Join(otherFolder, "outside")
	os.WriteFile(otherPath, []byte("outside scope"), 0600)
	if _, err = job.Execute(context.Background(), "read", otherPath, "", "", "", ""); err == nil {
		t.Fatal("foreground full mode widened scheduled authority")
	}
	valid = false
	if _, err = job.Execute(context.Background(), "read", path, "", "", "", ""); err == nil {
		t.Fatal("changed job retained access")
	}
	valid = true
	_, err = s.RevokeAll(policy.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = job.Execute(context.Background(), "read", path, "", "", "", ""); !errors.Is(err, ErrChanged) {
		t.Fatal("revocation was not enforced", err)
	}
}
