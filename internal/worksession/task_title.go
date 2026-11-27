package worksession

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Titles are display metadata, never an instruction or replacement objective.
func ValidTaskTitle(title string) bool {
	return title != "" && title == strings.TrimSpace(title) && utf8.ValidString(title) && len(title) <= 256 && utf8.RuneCountInString(title) <= 80 && !strings.ContainsFunc(title, unicode.IsControl) && title != "New chat"
}
