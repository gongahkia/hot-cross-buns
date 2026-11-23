package localmodel

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/state"
)

const RuntimeTokenHeader = "X-Hot-Cross-Buns-Runtime"

// RuntimeBinding is private host metadata. Neither its token nor certificate key
// belongs in a model setting, browser snapshot, prompt, or operation receipt.
type RuntimeBinding struct {
	Version     int    `json:"version"`
	Profile     string `json:"profile"`
	Endpoint    string `json:"endpoint"`
	Token       string `json:"token"`
	Certificate string `json:"certificate"`
	Generation  string `json:"generation"`
	ChildPID    int    `json:"child_pid"`
}

func RuntimeDirectory(root string) string {
	return filepath.Join(root, "hot-cross-buns", "local-runtime")
}
func RuntimeProfile(root string) string {
	absolute, _ := filepath.Abs(root)
	digest := sha256.Sum256([]byte(filepath.Clean(absolute)))
	return hex.EncodeToString(digest[:])
}

func ReadRuntimeBinding(root string) (*RuntimeBinding, error) {
	directory := RuntimeDirectory(root)
	if _, err := os.Lstat(directory); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err := privatefs.Check(directory); err != nil {
		return nil, err
	}
	fs, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer fs.Close()
	file, err := filelock.OpenRootFile(fs, "binding.json", os.O_RDONLY, 0600)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if err := privatefs.Check(filepath.Join(directory, "binding.json")); err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 32768 {
		return nil, errors.New("runtime metadata exceeds bounds")
	}
	var binding RuntimeBinding
	decoder := json.NewDecoder(io.LimitReader(file, 32769))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&binding); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid runtime metadata")
	}
	u, err := url.Parse(binding.Endpoint)
	if err != nil || binding.Version != 1 || binding.Profile != RuntimeProfile(root) || u.Scheme != "https" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Hostname() != "127.0.0.1" || u.Port() == "" || len(binding.Token) != 48 || len(binding.Generation) != 48 {
		return nil, errors.New("runtime metadata belongs to another or unavailable profile")
	}
	if _, err := hex.DecodeString(binding.Token); err != nil {
		return nil, errors.New("invalid runtime token")
	}
	if _, err := hex.DecodeString(binding.Generation); err != nil || binding.ChildPID < 0 {
		return nil, errors.New("invalid runtime generation or process")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(binding.Certificate)) {
		return nil, errors.New("invalid runtime certificate")
	}
	return &binding, nil
}

func RuntimeTLS(raw string) (*tls.Config, string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() {
		return nil, "", errors.New("invalid owned runtime origin")
	}
	root, err := state.ResolveDir("")
	if err != nil {
		return nil, "", err
	}
	binding, err := ReadRuntimeBinding(root)
	if err != nil || binding == nil || !strings.EqualFold(binding.Endpoint, "https://"+u.Host) {
		return nil, "", errors.New("HTTPS local runtime has no private certificate binding")
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(binding.Certificate))
	return &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}, binding.Token, nil
}
