package cliagent

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

func (c Config) UsesCodexLogin() bool { return c.Kind == "codex" && c.AuthMode == "codex_login" }

// localCodexLogin reads only the explicitly selected CLI credential file, not
// configuration, histories, instructions, or another application's secrets.
func (c Config) localCodexLogin() ([]byte, string, error) {
	path := filepath.Join(c.CodexHome, "auth.json")
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || runtime.GOOS != "windows" && before.Mode().Perm()&0077 != 0 {
		return nil, "", errors.New("local Codex login is unavailable or not private; run codex login locally")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, "", errors.New("cannot open local Codex login")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !os.SameFile(before, info) {
		return nil, "", errors.New("local Codex login changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(file, 128*1024+1))
	if err != nil || len(data) > 128*1024 {
		return nil, "", errors.New("cannot read bounded local Codex login")
	}
	var login struct {
		AuthMode string `json:"auth_mode"`
		Tokens   struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if json.Unmarshal(data, &login) != nil || login.AuthMode != "chatgpt" || login.Tokens.AccessToken == "" {
		return nil, "", errors.New("local Codex ChatGPT login is required; no manager API-key fallback is allowed")
	}
	return data, login.Tokens.AccessToken, nil
}

// stageCodexLogin provides the existing CLI login to its private HOME. The
// short-lived copy is removed when the owned CLI stops; the original is untouched.
func (c Config) stageCodexLogin(home string) (func(), error) {
	data, _, err := c.localCodexLogin()
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(home)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if err := root.Mkdir("codex", 0700); err != nil && !os.IsExist(err) {
		return nil, err
	}
	info, err := root.Lstat("codex")
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("private Codex home must be an ordinary directory")
	}
	codexRoot, err := root.OpenRoot("codex")
	if err != nil {
		return nil, err
	}
	ready := false
	defer func() {
		if !ready {
			codexRoot.Close()
		}
	}()
	if source, err := os.Stat(c.CodexHome); err == nil && os.SameFile(source, info) {
		return nil, errors.New("local Codex login must remain separate from the worker home")
	}
	if err = codexRoot.Remove("auth.json"); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	f, err := codexRoot.OpenFile("auth.json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		codexRoot.Remove("auth.json")
		return nil, errors.New("cannot prepare private Codex login")
	}
	ready = true
	return func() { _ = codexRoot.Remove("auth.json"); _ = codexRoot.Close() }, nil
}
