package agent

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// toolCatalog searches only the host-filtered inventory. Discovery changes
// visibility, never permissions, connector selection or execution authority.
type toolCatalog struct {
	definitions []ToolDefinition
	exposed     map[string]bool
	disabled    map[string]bool
}

func newToolCatalog(definitions []ToolDefinition, initial []string) (*toolCatalog, error) {
	c := &toolCatalog{definitions: definitions, exposed: map[string]bool{}, disabled: map[string]bool{}}
	names := map[string]bool{}
	for _, d := range definitions {
		if d.Name == "discover_tools" {
			return nil, errors.New("reserved discovery tool name")
		}
		names[d.Name] = true
	}
	for _, name := range initial {
		if !names[name] {
			return nil, errors.New("initial tool is outside the host inventory")
		}
		c.exposed[name] = true
	}
	return c, nil
}
func (c *toolCatalog) Definition() ToolDefinition {
	return ToolDefinition{Name: "discover_tools", Description: "Find additional available tools by capability or exact name. Discovery exposes existing host-permitted tools; it cannot grant access. Discover a tool before invoking it.", Parameters: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["query"],"properties":{"query":{"type":"string","minLength":1,"maxLength":256}}}`)}
}
func (c *toolCatalog) Execute(_ context.Context, raw json.RawMessage) (ToolResult, error) {
	type query struct {
		Query string `json:"query"`
	}
	input, err := DecodeStructured[query](Turn{Text: string(raw)}, 2048, nil)
	if err != nil || len(input.Query) > 256 || strings.TrimSpace(input.Query) == "" {
		return ToolResult{}, errors.New("provide a bounded tool capability query")
	}
	words := strings.Fields(strings.ToLower(input.Query))
	type scored struct {
		d     ToolDefinition
		score int
	}
	matches := []scored{}
	for _, d := range c.definitions {
		if c.disabled[d.Name] {
			continue
		}
		score := 0
		for _, word := range words {
			if strings.Contains(strings.ToLower(d.Name+" "+d.Description), word) {
				score++
			}
		}
		if strings.EqualFold(input.Query, d.Name) {
			score += 100
		}
		if score > 0 {
			matches = append(matches, scored{d, score})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].score > matches[j].score })
	found := []ToolDefinition{}
	for _, match := range matches[:min(8, len(matches))] {
		c.exposed[match.d.Name] = true
		found = append(found, match.d)
	}
	data, err := json.Marshal(struct {
		Tools []ToolDefinition `json:"tools"`
	}{found})
	return ToolResult{Content: string(data)}, err
}
func (c *toolCatalog) active() []ToolDefinition {
	out := []ToolDefinition{c.Definition()}
	for _, d := range c.definitions {
		if c.exposed[d.Name] && !c.disabled[d.Name] {
			out = append(out, d)
		}
	}
	return out
}
func exposedTools(all map[string]Tool, definitions []ToolDefinition) map[string]Tool {
	out := make(map[string]Tool, len(definitions))
	for _, d := range definitions {
		if tool, ok := all[d.Name]; ok {
			out[d.Name] = tool
		}
	}
	return out
}
