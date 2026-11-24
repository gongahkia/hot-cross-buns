package workapp

import (
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestFilesystemApprovalUsesExactBridgeTokenAndNeverBroadensOtherReviews(t *testing.T) {
	m := New(Config{})
	m.running = true
	m.interaction = &workrun.Interaction{ID: 17, Kind: "file_access", Preview: fileaccess.Review{Folder: "/approved", Access: "read"}}
	token := m.bridgeApprovalToken()
	next, _ := m.RespondBridgeApproval(17, "stale", true, "full")
	result := next.(Model)
	if result.bridgeNotice == "" {
		t.Fatal("stale token accepted")
	}
	next, _ = m.RespondBridgeApproval(17, token, true, "unknown")
	result = next.(Model)
	if result.bridgeNotice == "" {
		t.Fatal("unknown permission choice accepted")
	}
	m.interaction.Kind = "command"
	token = m.bridgeApprovalToken()
	next, _ = m.RespondBridgeApproval(17, token, true, "full")
	result = next.(Model)
	if result.bridgeNotice == "" {
		t.Fatal("non-filesystem review gained full access")
	}
}
