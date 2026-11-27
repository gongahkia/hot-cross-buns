package worksession

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/branding"
)

func TestTaskBakeryIdentityPersistsWithoutAssigningLegacyConversations(t *testing.T) {
	store, _ := Open(t.TempDir())
	parent, _ := store.CreateChat(t.TempDir(), time.Now())
	if store.TaskEmoji(parent.ID) != "" {
		t.Fatal("legacy conversation was assigned a new emoji")
	}
	turn := readyTask(t, store, parent.ID)
	_, child, _, err := store.BindDialogueTask(parent.ID, turn.ID, parent.SourcePath, turn.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	emoji := store.TaskEmoji(child.ID)
	if !branding.ValidBakeryEmoji(emoji) {
		t.Fatal("missing Unicode bakery emoji")
	}
	if err := store.retainTaskEmoji(child.ID); err != nil || store.TaskEmoji(child.ID) != emoji {
		t.Fatal("identity changed", err)
	}
	page, err := store.PageConversations(ConversationQuery{TaskParent: parent.ID})
	if err != nil || len(page.Items) != 1 || page.Items[0].TaskEmoji != emoji {
		t.Fatal("catalog lost assigned identity", err)
	}
	if err := os.WriteFile(filepath.Join(store.root, child.ID, "bakery.json"), []byte(`"<svg>"`), 0600); err != nil {
		t.Fatal(err)
	}
	if store.TaskEmoji(child.ID) != "" {
		t.Fatal("invalid identity reached public projection")
	}
}
