// Package memorysync exchanges reference data through immutable Markdown
// revisions. Runtime state, credentials and tool authority never enter a packet.
package memorysync

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

const maxPacket = 256 << 10
const maxPackets = 16384
const separator = "\n-->\n\n"

type Entry struct {
	Data json.RawMessage `json:"data,omitempty"`
	Text string          `json:"-"`
}
type event struct {
	Version int             `json:"version"`
	Device  string          `json:"device"`
	Key     string          `json:"key"`
	Parents []string        `json:"parents"`
	Deleted bool            `json:"deleted,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Text    string          `json:"-"`
	Hash    string          `json:"-"`
}
type observed struct {
	Heads  []string `json:"heads"`
	Digest string   `json:"digest"`
}
type localState struct {
	Version int                 `json:"version"`
	Device  string              `json:"device"`
	Entries map[string]observed `json:"entries"`
	Report  Report              `json:"report"`
}
type Choice struct {
	Hash   string `json:"hash"`
	Device string `json:"device"`
	Text   string `json:"text"`
}
type Conflict struct {
	Key      string   `json:"key"`
	Revision string   `json:"revision"`
	Choices  []Choice `json:"choices"`
}
type Report struct {
	Device          string     `json:"device"`
	LastRun         time.Time  `json:"last_run"`
	Published       int        `json:"published"`
	Imported        int        `json:"imported"`
	Pending         int        `json:"pending"`
	Conflicts       []Conflict `json:"conflicts"`
	Issues          []string   `json:"issues"`
	Delivery        string     `json:"delivery"`
	ImportedDevices int        `json:"imported_devices"`
	Peers           []Peer     `json:"peers,omitempty"`
}
type Store struct{ StateDir, Folder string }

func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func validDevice(value string) bool {
	if len(value) != 24 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func compact(data json.RawMessage) json.RawMessage {
	if len(data) == 0 {
		return nil
	}
	var buf bytes.Buffer
	if json.Compact(&buf, data) != nil {
		return data
	}
	return buf.Bytes()
}
func entryDigest(entry Entry) string {
	return digest(append(append(compact(entry.Data), '\n'), []byte(entry.Text)...))
}
func eventDigest(e event) string {
	if e.Deleted {
		return ""
	}
	return entryDigest(Entry{Data: e.Data, Text: e.Text})
}
func (s Store) localDirectory() string {
	return filepath.Join(s.StateDir, "hot-cross-buns", "memory-sync")
}
func (s Store) sharedDirectory() string { return filepath.Join(s.Folder, "hcb-memory-profile") }

func directory(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if resolved != absolute {
		return errors.New("sync directories must not contain symbolic links")
	}
	return privatefs.Protect(path)
}
func atomic(root *os.Root, name string, data []byte) error {
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	temp := ".hcb-" + hex.EncodeToString(random[:])
	f, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if info, err := root.Lstat(name); err == nil && !info.Mode().IsRegular() {
		return errors.New("sync target is not a regular file")
	}
	if err = root.Rename(temp, name); err != nil {
		return err
	}
	f, err = root.Open(".")
	if err != nil {
		return err
	}
	defer f.Close()
	return privatefs.SyncDir(f)
}
func read(root *os.Root, name string, limit int64) ([]byte, error) {
	before, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Size() > limit {
		return nil, errors.New("sync record must be a bounded regular file")
	}
	f, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	after, err := f.Stat()
	if err != nil || !os.SameFile(before, after) {
		return nil, errors.New("sync record changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("sync record exceeds size limit")
	}
	return data, nil
}
func decode(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing sync data")
	}
	return nil
}

func (s Store) open() (*os.Root, *os.File, localState, error) {
	var state localState
	if err := directory(s.localDirectory()); err != nil {
		return nil, nil, state, err
	}
	root, err := os.OpenRoot(s.localDirectory())
	if err != nil {
		return nil, nil, state, err
	}
	lock, err := filelock.OpenRootFile(root, ".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		root.Close()
		return nil, nil, state, err
	}
	if err = filelock.Lock(lock, filelock.Exclusive|filelock.Nonblocking); err != nil {
		lock.Close()
		root.Close()
		return nil, nil, state, errors.New("memory sync is already running")
	}
	data, err := read(root, "state.json", 16<<20)
	if errors.Is(err, os.ErrNotExist) {
		var random [12]byte
		_, err = rand.Read(random[:])
		state = localState{Version: 1, Device: hex.EncodeToString(random[:]), Entries: map[string]observed{}}
	} else if err == nil {
		err = decode(data, &state)
	}
	if err == nil && (state.Version != 1 || !validDevice(state.Device) || state.Entries == nil) {
		err = errors.New("invalid local sync state")
	}
	if err == nil {
		err = save(root, state)
	}
	if err != nil {
		filelock.Unlock(lock)
		lock.Close()
		root.Close()
		return nil, nil, state, err
	}
	return root, lock, state, nil
}
func save(root *os.Root, state localState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return atomic(root, "state.json", data)
}

func (s Store) capture() (map[string]Entry, error) {
	if _, err := personalization.SyncMarkdown(s.StateDir); err != nil {
		return nil, err
	}
	memories, err := memory.Open(s.StateDir)
	if err != nil {
		return nil, err
	}
	snapshot, err := memories.SyncSnapshot()
	if err != nil {
		return nil, err
	}
	entries := map[string]Entry{}
	for _, r := range snapshot.Records {
		text := r.Text
		r.Text = ""
		data, _ := json.Marshal(r)
		entries["memory:"+r.ID] = Entry{Data: data, Text: text}
	}
	for key, data := range snapshot.Metadata {
		entries["privacy:"+key] = Entry{Data: compact(data)}
	}
	notes, err := knowledge.Open(s.StateDir)
	if err != nil {
		return nil, err
	}
	documents, err := notes.ListAllNotes()
	if err != nil {
		return nil, err
	}
	for _, d := range documents {
		full, err := notes.LoadNote(d.ID)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(full)
		entries["note:"+d.ID] = Entry{Data: data, Text: full.Body}
	}
	return entries, nil
}
func packet(e event) ([]byte, error) {
	e.Data = compact(e.Data)
	header, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	data := []byte("<!-- hcb-sync " + string(header) + separator + e.Text)
	if len(data) > maxPacket {
		return nil, errors.New("sync packet exceeds size limit")
	}
	return data, nil
}
func publish(root *os.Root, e event) (event, error) {
	data, err := packet(e)
	if err != nil {
		return e, err
	}
	e.Hash = digest(data)
	e.Data = compact(e.Data)
	return e, atomic(root, e.Hash+".md", data)
}
func loadEvents(root *os.Root) (map[string]event, error) {
	dir, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	files, err := dir.ReadDir(maxPackets + 1)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(files) > maxPackets {
		return nil, errors.New("sync revision limit reached; archive before continuing")
	}
	events := map[string]event{}
	total := 0
	for _, file := range files {
		if strings.HasPrefix(file.Name(), ".") {
			continue
		}
		hash := strings.TrimSuffix(file.Name(), ".md")
		if !validHash(hash) {
			return nil, errors.New("unexpected file or transport conflict in sync revisions; preserve it for review")
		}
		data, err := read(root, file.Name(), maxPacket)
		if err != nil {
			return nil, err
		}
		total += len(data)
		if total > 64<<20 {
			return nil, errors.New("sync history exceeds 64 MiB; archive before continuing")
		}
		if digest(data) != hash || !bytes.HasPrefix(data, []byte("<!-- hcb-sync ")) {
			return nil, errors.New("sync revision changed outside its immutable identity")
		}
		parts := bytes.SplitN(data, []byte(separator), 2)
		var e event
		if len(parts) != 2 || decode(parts[0][len("<!-- hcb-sync "):], &e) != nil || e.Version != 1 || !validDevice(e.Device) || len(e.Parents) > 32 || len(e.Key) > 256 || (!strings.HasPrefix(e.Key, "memory:") && !strings.HasPrefix(e.Key, "note:") && !strings.HasPrefix(e.Key, "privacy:")) {
			return nil, errors.New("invalid sync revision")
		}
		for _, parent := range e.Parents {
			if !validHash(parent) || parent == hash {
				return nil, errors.New("invalid sync ancestry")
			}
		}
		if e.Deleted && (len(e.Data) > 0 || len(parts[1]) > 0) {
			return nil, errors.New("a deletion cannot carry forgotten text")
		}
		e.Text = string(parts[1])
		e.Hash = hash
		e.Data = compact(e.Data)
		events[hash] = e
	}
	return events, nil
}
func headsFor(events map[string]event) (map[string][]event, map[string]bool) {
	heads := map[string][]event{}
	parents := map[string]bool{}
	pending := map[string]bool{}
	for _, e := range events {
		for _, parent := range e.Parents {
			p, ok := events[parent]
			if !ok || p.Key != e.Key {
				pending[e.Key] = true
			} else {
				parents[parent] = true
			}
		}
	}
	for hash, e := range events {
		if !parents[hash] {
			heads[e.Key] = append(heads[e.Key], e)
		}
	}
	for key := range heads {
		slices.SortFunc(heads[key], func(a, b event) int { return strings.Compare(a.Hash, b.Hash) })
	}
	return heads, pending
}
func hashes(heads []event) []string {
	ids := make([]string, 0, len(heads))
	for _, e := range heads {
		ids = append(ids, e.Hash)
	}
	sort.Strings(ids)
	return ids
}
func keyDigest(heads []event) string { data, _ := json.Marshal(hashes(heads)); return digest(data) }

func (s Store) apply(key string, prior *Entry, e event) error {
	kind, id, ok := strings.Cut(key, ":")
	if !ok {
		return errors.New("invalid sync entity")
	}
	switch kind {
	case "memory":
		store, err := memory.Open(s.StateDir)
		if err != nil {
			return err
		}
		expected := ""
		if prior != nil {
			var r memory.Record
			if err = decode(prior.Data, &r); err != nil {
				return err
			}
			r.Text = prior.Text
			expected = memory.SyncRevision(r)
		}
		if e.Deleted {
			return store.ApplySyncRecord(id, expected, nil)
		}
		var r memory.Record
		if err = decode(e.Data, &r); err != nil {
			return err
		}
		r.Text = e.Text
		return store.ApplySyncRecord(id, expected, &r)
	case "note":
		store, err := knowledge.Open(s.StateDir)
		if err != nil {
			return err
		}
		expected := ""
		if prior != nil {
			var d knowledge.Document
			if err = decode(prior.Data, &d); err != nil {
				return err
			}
			d.Body = prior.Text
			expected = knowledge.SyncRevision(d)
		}
		if e.Deleted {
			return store.ApplySyncNote(id, expected, nil)
		}
		var d knowledge.Document
		if err = decode(e.Data, &d); err != nil {
			return err
		}
		d.Body = e.Text
		return store.ApplySyncNote(id, expected, &d)
	case "privacy":
		store, err := memory.Open(s.StateDir)
		if err != nil {
			return err
		}
		data := e.Data
		if e.Deleted {
			data = nil
		}
		var expected json.RawMessage
		if prior != nil {
			expected = prior.Data
		}
		return store.ApplySyncMetadata(id, expected, data)
	}
	return errors.New("unknown sync entity")
}

func (s Store) Run(ctx context.Context, resolveKey, resolveRevision, choice string) (Report, error) {
	root, lock, state, err := s.open()
	if err != nil {
		return Report{}, err
	}
	defer root.Close()
	defer lock.Close()
	defer filelock.Unlock(lock)
	report := Report{Device: state.Device, LastRun: time.Now().UTC(), Conflicts: []Conflict{}, Issues: []string{}, Delivery: "Saved locally; waiting for Syncthing"}
	shared, err := s.sharedRoot("changes")
	if err != nil {
		return report, err
	}
	defer shared.Close()
	events, err := loadEvents(shared)
	if err != nil {
		return report, err
	}
	current, err := s.capture()
	if err != nil {
		return report, err
	}
	for key, entry := range current {
		prior, known := state.Entries[key]
		value := entryDigest(entry)
		if known && prior.Digest == value {
			continue
		}
		e := event{Version: 1, Device: state.Device, Key: key, Parents: prior.Heads, Data: entry.Data, Text: entry.Text}
		e, err = publish(shared, e)
		if err != nil {
			return report, err
		}
		events[e.Hash] = e
		state.Entries[key] = observed{Heads: []string{e.Hash}, Digest: value}
		report.Published++
	}
	for key, prior := range state.Entries {
		if _, exists := current[key]; exists || prior.Digest == "" {
			continue
		}
		e, err := publish(shared, event{Version: 1, Device: state.Device, Key: key, Parents: prior.Heads, Deleted: true})
		if err != nil {
			return report, err
		}
		events[e.Hash] = e
		state.Entries[key] = observed{Heads: []string{e.Hash}}
		report.Published++
	}
	// Persist exported heads before importing: a retry cannot republish an old
	// local version as a new concurrent edit after an interrupted import.
	if err = save(root, state); err != nil {
		return report, err
	}
	heads, pending := headsFor(events)
	keys := make([]string, 0, len(heads))
	for key := range heads {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := strings.HasPrefix(keys[i], "privacy:"), strings.HasPrefix(keys[j], "privacy:")
		if a != b {
			return a
		}
		return keys[i] < keys[j]
	})
	for _, key := range keys {
		if err = ctx.Err(); err != nil {
			return report, err
		}
		if pending[key] {
			report.Pending++
			continue
		}
		tips := heads[key]
		if len(tips) > 32 {
			return report, errors.New("too many conflicting memory revisions")
		}
		selected := tips[0]
		same := true
		for _, tip := range tips[1:] {
			same = same && eventDigest(tip) == eventDigest(selected)
		}
		if strings.HasPrefix(key, "privacy:") {
			present := []event{}
			for _, tip := range tips {
				if !tip.Deleted {
					present = append(present, tip)
				}
			}
			if len(present) > 0 {
				selected = present[0]
				same = true
				for _, tip := range present[1:] {
					same = same && eventDigest(tip) == eventDigest(selected)
				}
				if strings.HasPrefix(key, "privacy:withdrawal/") {
					var rule memory.WithdrawalRule
					_ = json.Unmarshal(selected.Data, &rule)
					same = true
					for _, tip := range present[1:] {
						var other memory.WithdrawalRule
						if json.Unmarshal(tip.Data, &other) != nil || other.Scope != rule.Scope {
							same = false
							break
						}
						if !other.RestoredAt.IsZero() && rule.RestoredAt.IsZero() {
							continue
						}
						if other.RestoredAt.IsZero() && !rule.RestoredAt.IsZero() || other.ForgottenAt.After(rule.ForgottenAt) {
							selected = tip
							rule = other
						}
					}
				}
			} else {
				same = true
			}
		} else {
			for _, tip := range tips {
				if tip.Deleted {
					selected = tip
					same = true
					break
				}
			}
		}
		if strings.HasPrefix(key, "memory:") && !selected.Deleted {
			var r memory.Record
			if err = decode(selected.Data, &r); err != nil {
				return report, err
			}
			r.Text = selected.Text
			store, openErr := memory.Open(s.StateDir)
			if openErr != nil {
				return report, openErr
			}
			forgotten, checkErr := store.SyncForgotten(r)
			if checkErr != nil {
				return report, checkErr
			}
			if forgotten {
				selected, err = publish(shared, event{Version: 1, Device: state.Device, Key: key, Parents: hashes(tips), Deleted: true})
				if err != nil {
					return report, err
				}
				tips = []event{selected}
				report.Published++
				same = true
			}
		}
		resolving := key == resolveKey && resolveRevision == keyDigest(tips)
		if resolving {
			found := false
			for _, tip := range tips {
				if tip.Hash == choice {
					selected = tip
					found = true
					break
				}
			}
			if !found {
				return report, errors.New("choose a current conflicting revision")
			}
			same = true
		}
		if len(tips) > 1 && !same {
			conflict := Conflict{Key: key, Revision: keyDigest(tips)}
			for _, tip := range tips {
				conflict.Choices = append(conflict.Choices, Choice{Hash: tip.Hash, Device: tip.Device, Text: tip.Text})
			}
			report.Conflicts = append(report.Conflicts, conflict)
			continue
		}
		if len(tips) > 1 {
			selected.Parents = hashes(tips)
			selected.Device = state.Device
			selected, err = publish(shared, selected)
			if err != nil {
				return report, err
			}
			tips = []event{selected}
			report.Published++
		}
		desired := eventDigest(selected)
		entry, exists := current[key]
		actual := ""
		var before *Entry
		if exists {
			actual = entryDigest(entry)
			before = &entry
		}
		if desired != actual {
			if err = s.apply(key, before, selected); err != nil {
				report.Issues = append(report.Issues, key+": "+err.Error())
				continue
			}
			report.Imported++
		}
		state.Entries[key] = observed{Heads: hashes(tips), Digest: desired}
		if err = save(root, state); err != nil {
			return report, err
		}
	}
	if resolveKey != "" {
		tips := heads[resolveKey]
		if !slices.ContainsFunc(tips, func(t event) bool { return t.Hash == choice }) || resolveRevision != keyDigest(tips) {
			return report, errors.New("sync conflict changed; refresh before resolving")
		}
	}
	if err = s.exportViews(state.Device); err != nil {
		report.Issues = append(report.Issues, err.Error())
	}
	if len(report.Conflicts) == 0 && len(report.Issues) == 0 && report.Pending == 0 {
		report.ImportedDevices, err = s.acknowledge(state)
		if err != nil {
			return report, err
		}
	}
	state.Report = report
	if err = save(root, state); err != nil {
		return report, err
	}
	return report, nil
}

func (s Store) exportViews(device string) error {
	files, err := personalization.SyncMarkdown(s.StateDir)
	if err != nil {
		return err
	}
	root, err := s.sharedRoot("current/" + device)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, file := range files {
		data, err := os.ReadFile(file.Path)
		if err != nil {
			return err
		}
		if len(data) > 8<<20 {
			return errors.New("memory view exceeds limit")
		}
		data = append([]byte("<!-- Read-only sync view. Edit the original category file through HCB; changes to this copy are not imported. -->\n\n"), data...)
		if prior, readErr := read(root, filepath.Base(file.Path), 8<<20); readErr == nil && bytes.Equal(prior, data) {
			continue
		}
		if err = atomic(root, filepath.Base(file.Path), data); err != nil {
			return err
		}
	}
	return nil
}

func (s Store) Status() (Report, error) {
	// Published state is replaced atomically. Inspection must remain available
	// while an automatic import holds the mutation lease.
	root, err := os.OpenRoot(s.localDirectory())
	if err == nil {
		defer root.Close()
		for attempt := 0; attempt < 3; attempt++ {
			data, readErr := read(root, "state.json", 16<<20)
			if errors.Is(readErr, os.ErrNotExist) {
				break
			}
			if readErr != nil {
				continue
			}
			var state localState
			if err = decode(data, &state); err != nil {
				return Report{}, err
			}
			if state.Version != 1 || !validDevice(state.Device) {
				return Report{}, errors.New("invalid sync status")
			}
			state.Report.Device = state.Device
			return state.Report, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Report{}, err
	}
	root, lock, state, err := s.open()
	if err != nil {
		return Report{}, err
	}
	defer root.Close()
	defer lock.Close()
	defer filelock.Unlock(lock)
	state.Report.Device = state.Device
	return state.Report, nil
}

func (s Store) sharedRoot(subdirectory string) (*os.Root, error) {
	folder, err := os.OpenRoot(s.Folder)
	if err != nil {
		return nil, err
	}
	defer folder.Close()
	path := ""
	for _, part := range strings.Split("hcb-memory-profile/"+subdirectory, "/") {
		if part == "" || part == "." || part == ".." {
			return nil, errors.New("invalid sync directory")
		}
		path = filepath.Join(path, part)
		if err = folder.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		info, err := folder.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("sync path must be an ordinary directory")
		}
	}
	return folder.OpenRoot(path)
}

func (s Store) UpdateReport(report Report) error {
	root, lock, state, err := s.open()
	if err != nil {
		return err
	}
	defer root.Close()
	defer lock.Close()
	defer filelock.Unlock(lock)
	if state.Report.LastRun.After(report.LastRun) {
		return nil
	}
	state.Report = report
	return save(root, state)
}

func (s Store) acknowledge(state localState) (int, error) {
	heads := map[string][]string{}
	for key, entry := range state.Entries {
		heads[key] = entry.Heads
	}
	data, _ := json.Marshal(heads)
	fingerprint := digest(data)
	receipts, err := s.sharedRoot("receipts")
	if err != nil {
		return 0, err
	}
	defer receipts.Close()
	receipt := struct {
		Version int    `json:"version"`
		Device  string `json:"device"`
		Heads   string `json:"heads"`
	}{1, state.Device, fingerprint}
	encoded, _ := json.Marshal(receipt)
	if prior, readErr := read(receipts, state.Device+".json", 4096); readErr != nil || !bytes.Equal(prior, encoded) {
		if err = atomic(receipts, state.Device+".json", encoded); err != nil {
			return 0, err
		}
	}
	dir, err := receipts.Open(".")
	if err != nil {
		return 0, err
	}
	defer dir.Close()
	files, err := dir.ReadDir(65)
	if err != nil && err != io.EOF {
		return 0, err
	}
	if len(files) > 64 {
		return 0, errors.New("too many sync device receipts")
	}
	count := 0
	for _, file := range files {
		id := strings.TrimSuffix(file.Name(), ".json")
		if !validDevice(id) || id == state.Device {
			continue
		}
		data, err := read(receipts, file.Name(), 4096)
		if err != nil {
			return 0, err
		}
		var other struct {
			Version int    `json:"version"`
			Device  string `json:"device"`
			Heads   string `json:"heads"`
		}
		if decode(data, &other) != nil || other.Version != 1 || other.Device != id || !validHash(other.Heads) {
			return 0, errors.New("invalid HCB sync receipt")
		}
		if other.Heads == fingerprint {
			count++
		}
	}
	return count, nil
}
