package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSystemdJobUnitQuotesPathsAndRejectsControlCharacters(t *testing.T) {
	unit, err := systemdJobUnit("/opt/Hot Cross Buns App/hot-cross-buns%v", "/tmp/hot-cross-buns state", "/tmp/hot-cross-buns config")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`ExecStart="/opt/Hot Cross Buns App/hot-cross-buns%%v" job supervisor`, `Environment="HOT_CROSS_BUNS_STATE_DIR=/tmp/hot-cross-buns state"`, `Environment="HOT_CROSS_BUNS_CONFIG_DIR=/tmp/hot-cross-buns config"`, "WantedBy=default.target"} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
	for _, input := range []struct{ executable, state, config string }{{"relative", "/tmp/state", ""}, {"/bin/hot-cross-buns", "/tmp/state", "relative"}, {"/bin/hot-cross-buns\nExecStart=/bin/sh", "/tmp/state", ""}} {
		if _, err := systemdJobUnit(input.executable, input.state, input.config); err == nil {
			t.Fatalf("accepted invalid unit paths: %+v", input)
		}
	}
}

func TestJobSystemdManagesOnlyItsUserUnit(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("systemd user service is Linux-only")
	}
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(root, "systemctl.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HOT_CROSS_BUNS_SYSTEMCTL_LOG\"\n"
	if err := os.WriteFile(filepath.Join(bin, "systemctl"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("HOT_CROSS_BUNS_SYSTEMCTL_LOG", logPath)
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", filepath.Join(root, "state"))
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", filepath.Join(root, "hot-cross-buns config"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "xdg config"))
	var output bytes.Buffer
	if err := jobSystemd([]string{"install"}, &output); err != nil {
		t.Fatal(err)
	}
	unitPath := filepath.Join(root, "xdg config", "systemd", "user", jobSystemdUnitName)
	info, err := os.Stat(unitPath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("installed unit = %v, %v", info, err)
	}
	unit, err := os.ReadFile(unitPath)
	if err != nil || !strings.Contains(string(unit), `Environment="HOT_CROSS_BUNS_CONFIG_DIR=`) {
		t.Fatalf("unit = %s, %v", unit, err)
	}
	if err := jobSystemd([]string{"remove"}, &output); err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Fatalf("remove without confirmation = %v", err)
	}
	if err := jobSystemd([]string{"status"}, &output); err != nil {
		t.Fatal(err)
	}
	if err := jobSystemd([]string{"remove", "--yes"}, &output); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(unitPath); !os.IsNotExist(err) {
		t.Fatalf("unit still exists: %v", err)
	}
	logData, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"--user daemon-reload", "--user enable --now " + jobSystemdUnitName, "--user restart " + jobSystemdUnitName, "--user --no-pager status " + jobSystemdUnitName, "--user disable --now " + jobSystemdUnitName} {
		if !strings.Contains(string(logData), want) {
			t.Fatalf("systemctl calls missing %q:\n%s", want, logData)
		}
	}
}
