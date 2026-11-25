package personalization

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

type MarkdownFile struct {
	Category string `json:"category"`
	Path     string `json:"path"`
}

var markdownCategories = []struct{ category, file string }{
	{"Preferences", "preferences.md"}, {"About you", "about-you.md"}, {"Personal context", "personal-context.md"},
	{"Saved context", "saved-notes.md"}, {"Projects and goals", "projects.md"}, {"Guidance", "guidance.md"},
	{"Suggestions", "suggestions.md"}, {"Routines", "routines.md"},
}

type markdownEntry struct {
	Kind, Revision, Text string
	Editable             bool
}
type markdownSnapshot struct {
	Hash    string
	Entries map[string]markdownEntry
}

const markdownLimit = 8 << 20

func markdownHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// Category files are editable views over the owning stores. Their IDs and
// provenance remain structured; plain text cannot activate a proposal or routine.
func SyncMarkdown(stateDir string) ([]MarkdownFile, error) {
	if _, err := memory.Open(stateDir); err != nil {
		return nil, err
	}
	rootPath := filepath.Join(stateDir, "hot-cross-buns", "memory", "categories")
	if err := os.Mkdir(rootPath, 0700); err != nil && !os.IsExist(err) {
		return nil, err
	}
	info, err := os.Lstat(rootPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("memory category directory must be an ordinary private directory")
	}
	if err := privatefs.Protect(rootPath); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	lock, err := filelock.OpenRootFile(root, ".sync-lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	if err := filelock.Lock(lock, filelock.Exclusive); err != nil {
		return nil, err
	}
	defer filelock.Unlock(lock)
	catalog, err := readMarkdownCatalog(stateDir)
	if err != nil {
		return nil, err
	}
	var files []MarkdownFile
	for _, category := range markdownCategories {
		files = append(files, MarkdownFile{Category: category.category, Path: filepath.Join(rootPath, category.file)})
		changed := false
		if err := syncMarkdownCategory(stateDir, root, category.category, category.file, catalog, &changed); err != nil {
			return files, fmt.Errorf("%s: %w", category.file, err)
		}
		if changed {
			catalog, err = readMarkdownCatalog(stateDir)
			if err != nil {
				return files, err
			}
		}
	}
	return files, nil
}

func readMarkdown(root *os.Root, name string) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > markdownLimit {
		return nil, errors.New("memory file must be a bounded regular file")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("memory file changed during read")
	}
	data, err := io.ReadAll(io.LimitReader(file, markdownLimit+1))
	if err != nil || len(data) > markdownLimit {
		return nil, errors.New("memory file exceeds the supported size")
	}
	return data, nil
}

func writeMarkdown(root *os.Root, name string, data []byte) error {
	if len(data) > markdownLimit {
		return errors.New("memory category exceeds the supported size")
	}
	// All managed writers hold the category lease. Refuse linked destinations.
	if info, err := root.Lstat(name); err == nil && !info.Mode().IsRegular() {
		return errors.New("memory destination is not a regular file")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	tempName := ".category-" + hex.EncodeToString(nonce[:])
	temp, err := root.OpenFile(tempName, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(tempName)
	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := root.Rename(tempName, name); err != nil {
		return err
	}
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return privatefs.SyncDir(dir)
}

func readMarkdownCatalog(stateDir string) ([]Topic, error) {
	catalog, err := readCatalog(stateDir, "", "", 0, true)
	if err != nil {
		return nil, err
	}
	if len(catalog.Warnings) > 0 {
		return nil, errors.New(strings.Join(catalog.Warnings, "; "))
	}
	return catalog.Entries, nil
}
func categoryTopics(topics []Topic, category string) []Topic {
	var entries []Topic
	for _, topic := range topics {
		if topic.Category == category {
			entries = append(entries, topic)
		}
	}
	return entries
}

func renderMarkdown(category string, topics []Topic) ([]byte, markdownSnapshot) {
	var text strings.Builder
	fmt.Fprintf(&text, "# %s\n\nEdit text between the hcb-text markers. Keep headings, IDs and markers intact.\nChanges import on Memory refresh or before the next request. Add and forget through Memory.\nSuggestions, guidance, routines and goal-scoped records use their reviewed controls; their entries are read-only here.\n\n", category)
	snapshot := markdownSnapshot{Entries: map[string]markdownEntry{}}
	for _, topic := range topics {
		editable := topic.Editable && (topic.Kind == "memory" || topic.Kind == "note")
		snapshot.Entries[topic.ID] = markdownEntry{Kind: topic.Kind, Revision: topic.Revision, Text: strings.TrimSpace(topic.Text), Editable: editable}
		fmt.Fprintf(&text, "## %s\n\nScope: %s · Status: %s · %s\n\n<!-- hcb-text:%s -->\n%s\n<!-- /hcb-text:%s -->\n\n", strings.ReplaceAll(topic.Title, "\n", " "), topic.Scope, topic.Status, map[bool]string{true: "editable", false: "read-only"}[editable], topic.ID, strings.TrimSpace(topic.Text), topic.ID)
	}
	data := []byte(text.String())
	snapshot.Hash = markdownHash(data)
	return data, snapshot
}

func syncMarkdownCategory(stateDir string, root *os.Root, category, name string, catalog []Topic, changed *bool) error {
	var previous markdownSnapshot
	index, indexErr := readMarkdown(root, "."+name+".json")
	if indexErr == nil {
		if err := json.Unmarshal(index, &previous); err != nil {
			return errors.New("memory file index is invalid; preserve the file and repair its index")
		}
	} else if !os.IsNotExist(indexErr) {
		return indexErr
	}
	data, readErr := readMarkdown(root, name)
	if readErr != nil && !os.IsNotExist(readErr) {
		return readErr
	}
	pendingName := ".pending-" + name + ".json"
	if pendingData, pendingErr := readMarkdown(root, pendingName); pendingErr == nil {
		var pending markdownSnapshot
		if err := json.Unmarshal(pendingData, &pending); err != nil {
			return errors.New("interrupted memory export index is invalid")
		}
		if readErr == nil && markdownHash(data) == pending.Hash {
			previous = pending
			indexErr = nil
		} else if readErr == nil && markdownHash(data) != previous.Hash {
			return errors.New("file changed during an interrupted export; preserve its edits before repair")
		}
	} else if !os.IsNotExist(pendingErr) {
		return pendingErr
	}
	if os.IsNotExist(indexErr) && readErr == nil {
		return errors.New("untracked Markdown exists; move it aside before creating the managed category file")
	}
	topics := categoryTopics(catalog, category)
	if readErr == nil && previous.Hash != markdownHash(data) {
		current := map[string]Topic{}
		for _, topic := range topics {
			current[topic.ID] = topic
		}
		changes, err := parseMarkdownEdits(string(data), previous)
		if err != nil {
			return err
		}
		for id, text := range changes {
			topic, exists := current[id]
			if !exists {
				return fmt.Errorf("%s was removed or moved; preserve your edits and refresh its saved record", id)
			}
			if strings.TrimSpace(topic.Text) == text {
				continue
			} // an interrupted import already applied this entry.
			base := previous.Entries[id]
			if !topic.Editable || (topic.Kind != "memory" && topic.Kind != "note") {
				return errors.New("this entry requires its owning reviewed controls")
			}
			if topic.Revision != base.Revision {
				return fmt.Errorf("%s changed in HCB too; preserve your edits and reconcile the current saved version", id)
			}
			if err := changeTopic(stateDir, CatalogAction{Action: "correct", ID: id, Revision: base.Revision, Text: text}); err != nil {
				return err
			}
			*changed = true
		}
		if *changed {
			updated, err := readMarkdownCatalog(stateDir)
			if err != nil {
				return err
			}
			topics = categoryTopics(updated, category)
		}
	}
	output, next := renderMarkdown(category, topics)
	if readErr == nil {
		latest, err := readMarkdown(root, name)
		if err != nil {
			return err
		}
		if markdownHash(latest) != markdownHash(data) {
			return errors.New("file changed during synchronization; retry after finishing the edit")
		}
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if readErr != nil || string(output) != string(data) || string(encoded) != string(index) {
		if err := writeMarkdown(root, pendingName, encoded); err != nil {
			return err
		}
		if err := writeMarkdown(root, name, output); err != nil {
			return err
		}
		if err := writeMarkdown(root, "."+name+".json", encoded); err != nil {
			return err
		}
	}
	if err := root.Remove(pendingName); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func parseMarkdownEdits(text string, previous markdownSnapshot) (map[string]string, error) {
	changes := map[string]string{}
	for id, entry := range previous.Entries {
		start, end := "<!-- hcb-text:"+id+" -->", "<!-- /hcb-text:"+id+" -->"
		if strings.Count(text, start) != 1 || strings.Count(text, end) != 1 {
			return nil, fmt.Errorf("keep the markers for %s; use Memory to add or forget entries", id)
		}
		a, b := strings.Index(text, start)+len(start), strings.Index(text, end)
		if b < a {
			return nil, errors.New("memory text markers are out of order")
		}
		value := strings.TrimSpace(text[a:b])
		if strings.Contains(value, "<!-- hcb-text:") || strings.Contains(value, "<!-- /hcb-text:") {
			return nil, errors.New("memory entry markers cannot be nested")
		}
		if value == entry.Text {
			continue
		}
		if !entry.Editable {
			return nil, fmt.Errorf("%s is read-only here; use its reviewed controls in Memory", id)
		}
		if value == "" || len(value) > 64*1024 {
			return nil, errors.New("memory text must be nonempty and within its record size limit")
		}
		changes[id] = value
	}
	if strings.Count(text, "<!-- hcb-text:") != len(previous.Entries) {
		return nil, errors.New("unknown memory markers; add new entries through Memory")
	}
	return changes, nil
}
