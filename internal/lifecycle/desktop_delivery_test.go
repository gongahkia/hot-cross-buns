package lifecycle

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/inbox"
)

func TestDesktopDeliveryBackupRetainsOutcomeWithoutProcessLocks(t *testing.T) {
	state := t.TempDir()
	mailbox, _ := inbox.Open(state)
	e, err := mailbox.Add(inbox.Entry{Kind: "job", Title: "Update", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = mailbox.SendDesktopNotification(e.ID, time.Now(), func(inbox.Entry) error { return errors.New("offline") })
	s, err := Open(state)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "profile.tar.gz")
	report, err := s.Export(context.Background(), destination)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := report.Files["hot-cross-buns/inbox/"+e.ID+".json"]; !ok {
		t.Fatal("delivery outcome absent from backup")
	}
	for path := range report.Files {
		if strings.HasPrefix(path, "hot-cross-buns/inbox/") && strings.HasSuffix(path, ".lock") {
			t.Fatal("process lease exported", path)
		}
	}
	if _, err := VerifyBackup(context.Background(), destination); err != nil {
		t.Fatal(err)
	}
}
