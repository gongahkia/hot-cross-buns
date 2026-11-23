//go:build windows

package localruntime

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func detach(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200 | 0x00000008, HideWindow: true}
}
func processAlive(pid int) bool {
	if pid <= 1 {
		return false
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)
	var code uint32
	return windows.GetExitCodeProcess(handle, &code) == nil && code == 259
}
func terminate(owned *child) error { return owned.command.Process.Kill() }
func verifyListener(pid int, binary, address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" || pid <= 1 {
		return errors.New("invalid owner listener")
	}
	if _, err = strconv.ParseUint(port, 10, 16); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	script := "$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + strconv.Itoa(pid) + "'; $n=@(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort " + port + " -ErrorAction Stop); @{Path=$p.ExecutablePath;Owned=@($n|Where-Object {$_.OwningProcess -eq " + strconv.Itoa(pid) + "}).Count} | ConvertTo-Json -Compress"
	shell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	data, err := exec.CommandContext(ctx, shell, "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil || len(data) > 16384 {
		return errors.New("runtime owner could not be inspected")
	}
	var value struct {
		Path  string
		Owned int
	}
	if json.Unmarshal(data, &value) != nil || !strings.EqualFold(filepath.Clean(value.Path), filepath.Clean(binary)) || value.Owned < 1 {
		return errors.New("listener and executable ownership could not be verified")
	}
	return nil
}
