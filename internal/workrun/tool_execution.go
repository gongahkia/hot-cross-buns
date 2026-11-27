package workrun

import (
	"encoding/json"
	"path"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
)

func initialWorkTools(surface []agent.Tool) []string {
	// Common conversational, observation and handoff tools stay immediately
	// available. Large provider/document/app surfaces are found on demand.
	common := map[string]bool{}
	for _, name := range strings.Fields("read_file list_files search_files filesystem knowledge_search knowledge_read memory_remember memory_enrich_project web_access http_fetch search_web list_agents start_agent delegate_agents inspect_agent await_agent cancel_agent steer_agent answer_agent write_artifact artifact_status read_evidence check_claims hot_cross_buns_request_access hot_cross_buns_app_inspect hot_cross_buns_app_update") {
		common[name] = true
	}
	names := []string{}
	for _, tool := range surface {
		if name := tool.Definition().Name; common[name] {
			names = append(names, name)
		}
	}
	return names
}
func frozenIndependentRead(surface []agent.Tool) func(agent.ToolCall) bool {
	safe := map[string]bool{}
	for _, tool := range surface {
		if decorated, ok := tool.(activityIconTool); ok {
			tool = decorated.Tool
		}
		switch tool.(type) {
		case tools.ReadFile, tools.ListFiles, tools.SearchFiles:
			safe[tool.Definition().Name] = true
		}
	}
	return func(call agent.ToolCall) bool {
		if !safe[call.Name] {
			return false
		}
		var input struct {
			Path string `json:"path"`
		}
		if json.Unmarshal(call.Arguments, &input) != nil || strings.Contains(input.Path, "\\") {
			return false
		}
		cleaned := path.Clean(input.Path)
		return cleaned == "source" || strings.HasPrefix(cleaned, "source/")
	}
}
