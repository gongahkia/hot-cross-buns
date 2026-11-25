package memory

import "testing"

func TestIntroductionUsesOneReviewedSnapshotAndPreservesMemoryIdentity(t *testing.T) {
	store, _ := Open(t.TempDir())
	revision, err := store.IntroductionRevision()
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]string{"profile.name": "Name: Alice", "preference.tone": "Reply style: Casual", "profile.projects": "I work on a garden project."}
	if err := store.SaveIntroduction(fields, revision); err != nil {
		t.Fatal(err)
	}
	records, err := store.List("", true)
	if err != nil || len(records) != 3 {
		t.Fatal("intake not saved together", len(records), err)
	}
	if err := store.SaveIntroduction(fields, revision); err == nil {
		t.Fatal("stale intake overwrote newer profile")
	}
	next, _ := store.IntroductionRevision()
	fields["profile.name"] = "Name: Alex"
	if err := store.SaveIntroduction(fields, next); err != nil {
		t.Fatal(err)
	}
	updated, _ := store.List("", true)
	if len(updated) != 3 {
		t.Fatal("intake added duplicate memories")
	}
	for _, record := range updated {
		found := false
		for _, prior := range records {
			if prior.ID == record.ID {
				found = true
			}
		}
		if !found {
			t.Fatal("profile identity changed")
		}
	}
	profile, err := store.Profile(nil)
	if err != nil || len(profile) != 2 {
		t.Fatal("name and style absent from profile", len(profile), err)
	}
}
