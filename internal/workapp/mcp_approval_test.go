package workapp

import (
	"github.com/gongahkia/hot-cross-buns/internal/mcpaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"strings"
	"testing"
)

func TestMCPReviewShowsPersistentAuthorityAndRejectsFullFilesystemChoice(t *testing.T) {
	review := mcpaccess.Review{Connection: mcpaccess.Scope{Repository: "/project", Hash: "bundle", Server: "sagasu"}, Tool: "wait_operation"}
	result := approvalMessage(workrun.Interaction{Kind: "mcp_call", Preview: review})
	if !strings.Contains(result.result.Summary, "all tools and actions") || !strings.Contains(result.result.Footer, "Permissions") {
		t.Fatal("scope unclear", result.result)
	}
	m := New(Config{})
	m.running = true
	m.interaction = &workrun.Interaction{ID: 18, Kind: "mcp_call", Preview: review}
	next, _ := m.RespondBridgeApproval(18, m.bridgeApprovalToken(), true, "full")
	if next.(Model).bridgeNotice == "" {
		t.Fatal("MCP review gained filesystem permission")
	}
}
