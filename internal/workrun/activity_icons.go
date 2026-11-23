package workrun

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/workactivity"
)

// activityIconTool removes presentation metadata before the original tool's
// validation and execution. It cannot alter execution state or permission.
type activityIconTool struct {
	agent.Tool
	definition agent.ToolDefinition
}

func withActivityIcon(tool agent.Tool) agent.Tool {
	definition := tool.Definition()
	var schema map[string]json.RawMessage
	var properties map[string]json.RawMessage
	if json.Unmarshal(definition.Parameters, &schema) != nil || string(schema["type"]) != `"object"` {
		return tool
	}
	if raw, exists := schema["properties"]; exists && json.Unmarshal(raw, &properties) != nil {
		return tool
	}
	if properties == nil {
		properties = map[string]json.RawMessage{}
	}
	if properties["display_icon"] != nil {
		return tool
	}
	properties["display_icon"], _ = json.Marshal(map[string]any{
		"type": "string", "enum": workactivity.DisplayIcons(),
		"description": "Optional Lucide icon for this activity in the chat. Choose one that describes the work. Presentation only; it does not report completion or change permissions.",
	})
	schema["properties"], _ = json.Marshal(properties)
	definition.Parameters, _ = json.Marshal(schema)
	return activityIconTool{Tool: tool, definition: definition}
}

func (t activityIconTool) Definition() agent.ToolDefinition { return t.definition }

func (t activityIconTool) Execute(ctx context.Context, arguments json.RawMessage) (agent.ToolResult, error) {
	arguments, err := activityArguments(arguments)
	if err != nil {
		return agent.ToolResult{}, err
	}
	return t.Tool.Execute(ctx, arguments)
}

func activityArguments(arguments json.RawMessage) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(arguments, &fields) != nil || fields == nil {
		return arguments, nil
	}
	if raw, present := fields["display_icon"]; present {
		var name string
		if json.Unmarshal(raw, &name) != nil || !workactivity.ValidDisplayIcon(name) {
			return nil, errors.New("choose a supported display_icon")
		}
		delete(fields, "display_icon")
		arguments, _ = json.Marshal(fields)
	}
	return arguments, nil
}

func (t activityIconTool) DisplayBrand(arguments json.RawMessage) string {
	arguments, err := activityArguments(arguments)
	if err != nil {
		return ""
	}
	return agent.ToolBrand(t.Tool, arguments)
}
