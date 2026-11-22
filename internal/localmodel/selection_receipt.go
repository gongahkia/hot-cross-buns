package localmodel

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"time"

	"github.com/gongahkia/gator/internal/filelock"
	"github.com/gongahkia/gator/internal/privatefs"
)

// SelectionReceipt records configuration publication only. It is not a model-use
// lease, download receipt, inference result or external-action authorization.
type SelectionReceipt struct {
	Version          int    `json:"version"`
	ID               string `json:"id"`
	RequestID        string `json:"request_id"`
	ProfileID        string `json:"profile_id"`
	Generation       string `json:"generation"`
	Endpoint         string `json:"endpoint"`
	ModelID          string `json:"model_id"`
	Tag              string `json:"tag"`
	Digest           string `json:"digest"`
	SettingsRevision string `json:"settings_revision"`
	Phase            string `json:"phase"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

var receiptID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

func (r SelectionReceipt) Validate() error {
	if r.Version != 1 || !receiptID.MatchString(r.ID) || !receiptID.MatchString(r.RequestID) || !receiptID.MatchString(r.ProfileID) || !receiptID.MatchString(r.Generation) {
		return errors.New("invalid selection receipt identity")
	}
	if len(r.Endpoint) > 2048 || len(r.Tag) > 512 {
		return errors.New("selection receipt exceeds bounds")
	}
	if _, err := LocalURL(r.Endpoint); err != nil {
		return errors.New("invalid receipt endpoint")
	}
	m, ok := Resolve(r.ModelID)
	if !ok || m.OllamaModel != r.Tag {
		return errors.New("unreviewed receipt model")
	}
	if _, err := ModelDigest(r.Digest); err != nil {
		return err
	}
	if _, err := ModelDigest(r.SettingsRevision); err != nil {
		return errors.New("invalid reviewed settings identity")
	}
	if _, err := time.Parse(time.RFC3339Nano, r.CreatedAt); err != nil {
		return errors.New("invalid receipt timestamp")
	}
	if _, err := time.Parse(time.RFC3339Nano, r.UpdatedAt); err != nil {
		return errors.New("invalid receipt timestamp")
	}
	switch r.Phase {
	case "prepared", "published", "failed", "uncertain", "reconciled":
	default:
		return errors.New("unknown selection outcome")
	}
	return nil
}

type SelectionReceipts struct{ Directory string }

func NewSelectionReceipts(stateDir string) SelectionReceipts {
	return SelectionReceipts{Directory: filepath.Join(stateDir, "gator", "local-selection")}
}
func (s SelectionReceipts) Read() (*SelectionReceipt, error) {
	if _, err := os.Lstat(s.Directory); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err := privatefs.Check(s.Directory); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.Directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return readSelectionReceipt(root)
}
func readSelectionReceipt(root *os.Root) (*SelectionReceipt, error) {
	file, err := filelock.OpenRootFile(root, "selection.json", os.O_RDONLY, 0600)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if err := privatefs.Check(filepath.Join(root.Name(), "selection.json")); err != nil {
		return nil, err
	}
	if info, e := file.Stat(); e != nil || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("selection receipt is not private")
	}
	data, err := io.ReadAll(io.LimitReader(file, 16*1024+1))
	if err != nil || len(data) > 16*1024 {
		return nil, errors.New("selection receipt exceeds bounds")
	}
	var r SelectionReceipt
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoderErr := decoder.Decode(&r)
	if decoderErr == nil {
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			decoderErr = errors.New("trailing receipt data")
		}
	}
	if decoderErr != nil {
		return nil, errors.New("selection receipt is unreadable")
	}
	if err := r.Validate(); err != nil {
		return nil, err
	}
	return &r, nil
}

type SelectionReceiptLease struct {
	root *os.Root
	lock *os.File
}

func (s SelectionReceipts) Lock() (*SelectionReceiptLease, error) {
	if err := privatefs.MkdirAll(s.Directory); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.Directory)
	if err != nil {
		return nil, err
	}
	lock, err := filelock.OpenRootFile(root, ".operation.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		root.Close()
		return nil, err
	}
	if err := filelock.Lock(lock, filelock.Exclusive|filelock.Nonblocking); err != nil {
		lock.Close()
		root.Close()
		return nil, errors.New("another process owns a local selection operation")
	}
	return &SelectionReceiptLease{root: root, lock: lock}, nil
}
func (l *SelectionReceiptLease) Close() {
	_ = filelock.Unlock(l.lock)
	_ = l.lock.Close()
	_ = l.root.Close()
}
func (l *SelectionReceiptLease) Read() (*SelectionReceipt, error) {
	return readSelectionReceipt(l.root)
}
func (l *SelectionReceiptLease) Write(r SelectionReceipt) error {
	if err := r.Validate(); err != nil {
		return err
	}
	data, err := json.Marshal(r)
	if err != nil || len(data) > 16*1024 {
		return errors.New("invalid selection receipt")
	}
	// the operation lock serializes this fixed temporary name; neither path is caller-controlled.
	file, err := filelock.OpenRootFile(l.root, ".selection.tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer l.root.Remove(".selection.tmp")
	if err := privatefs.Protect(filepath.Join(l.root.Name(), ".selection.tmp")); err != nil {
		file.Close()
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = l.root.Rename(".selection.tmp", "selection.json"); err != nil {
		return err
	}
	directory, err := l.root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	return privatefs.SyncDir(directory)
}
