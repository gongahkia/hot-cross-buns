package workactivity

import (
	_ "embed"
	"encoding/json"
	"slices"
)

//go:embed icon-names.json
var displayIconNames []byte

// DisplayIcons is shared with the browser's bundled Lucide catalog.
func DisplayIcons() []string {
	var names []string
	_ = json.Unmarshal(displayIconNames, &names)
	return names
}

func ValidDisplayIcon(name string) bool { return slices.Contains(DisplayIcons(), name) }

func displayIcon(arguments json.RawMessage) string {
	if len(arguments) > 1024*1024 {
		return ""
	}
	var value struct {
		Icon string `json:"display_icon"`
	}
	if json.Unmarshal(arguments, &value) == nil && ValidDisplayIcon(value.Icon) {
		return value.Icon
	}
	return ""
}
