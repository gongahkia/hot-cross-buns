package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReviewedLiveFilesStayScopedAndProtectPermissionOwner(t *testing.T) {
	if _, err := StrictAvailability(); err != nil {
		t.Skip(err)
	}
	canonical := func(p string) string {
		v, err := filepath.EvalSymlinks(p)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	checkout := canonical(t.TempDir())
	allowed := canonical(t.TempDir())
	outside := canonical(t.TempDir())
	control := filepath.Join(allowed, "hcb-control")
	os.Mkdir(control, 0700)
	os.WriteFile(filepath.Join(allowed, "note"), []byte("visible"), 0600)
	os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	os.WriteFile(filepath.Join(control, "policy"), []byte("private"), 0600)
	run := func(write bool, script string) error {
		t.Helper()
		live := &LiveFilesystem{Read: []string{allowed}, Protected: []string{control}, Fingerprint: "reviewed"}
		if write {
			live.Write = []string{allowed}
		}
		prepared, err := Prepare(context.Background(), Request{Dir: checkout, Argv: []string{"/bin/sh", "-c", script}, Policy: Policy{Mode: Strict, Network: DenyNetwork, LiveFiles: live}})
		if err != nil {
			t.Fatal(err)
		}
		defer prepared.Cleanup()
		return prepared.Command.Run()
	}
	if err := run(false, "cat '"+filepath.Join(allowed, "note")+"' >/dev/null"); err != nil {
		t.Fatal("approved live read failed", err)
	}
	if err := run(false, "cat '"+filepath.Join(outside, "secret")+"' >/dev/null"); err == nil {
		t.Fatal("outside grant readable")
	}
	if err := run(false, "cat '"+filepath.Join(control, "policy")+"' >/dev/null"); err == nil {
		t.Fatal("permission owner readable")
	}
	if err := run(false, "echo bad > '"+filepath.Join(allowed, "new")+"'"); err == nil {
		t.Fatal("read grant wrote")
	}
	if err := run(true, "echo good > '"+filepath.Join(allowed, "new")+"'"); err != nil {
		t.Fatal("approved live write failed", err)
	}
	if err := run(true, "echo bad > '"+filepath.Join(control, "policy")+"'"); err == nil {
		t.Fatal("permission store writable")
	}
}
func TestReviewedFilesCannotEscapeOuterEnvelope(t *testing.T) {
	_, err := EffectivePolicy(WithEnvelope(context.Background(), Policy{Mode: Strict, WritablePaths: []string{"limited"}}), Policy{Mode: Strict, LiveFiles: &LiveFilesystem{Read: []string{t.TempDir()}, Protected: []string{t.TempDir()}, Fingerprint: "approved elsewhere"}})
	if err == nil {
		t.Fatal("outer host envelope was widened")
	}
	if err := (Policy{LiveFiles: &LiveFilesystem{Read: []string{"/"}, Protected: []string{t.TempDir()}, Fingerprint: "no-full"}}).Validate(); err == nil {
		t.Fatal("root enabled without full access")
	}
}
