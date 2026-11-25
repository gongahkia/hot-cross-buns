package personalization

import (
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"testing"
	"time"
)

func TestCatalogRecallControlsPreserveRevisionAndFreshness(t *testing.T) {
	state := t.TempDir()
	s, _ := memory.Open(state)
	r, _ := s.Add("preference", "I prefer concise reports.", "", "Added by you", time.Time{})
	action := CatalogAction{Action: "pin", ID: r.ID, Revision: r.UpdatedAt.Format(time.RFC3339Nano)}
	out := ApplyCatalog(state, action)
	if out.Error != "" {
		t.Fatal(out.Error)
	}
	changed, _ := s.Load(r.ID)
	if changed.Policy == nil || !changed.Policy.Pinned || changed.LastConfirmedAt != r.LastConfirmedAt {
		t.Fatal(changed)
	}
	if out := ApplyCatalog(state, action); out.Error == "" {
		t.Fatal("stale revision accepted")
	}
	out = ApplyCatalog(state, CatalogAction{Action: "snooze", ID: r.ID, Revision: changed.UpdatedAt.Format(time.RFC3339Nano), Until: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	if out.Error != "" {
		t.Fatal(out.Error)
	}
	rows, _ := s.List("", false)
	if rows[0].Recallable() {
		t.Fatal("snoozed memory recalled")
	}
	if len(out.Catalog.Entries) != 1 || out.Catalog.Entries[0].RecallIssue == "" || !out.Catalog.Entries[0].CanManageRecall {
		t.Fatal(out)
	}
}
