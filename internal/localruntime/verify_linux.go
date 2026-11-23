//go:build linux

package localruntime

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func detach(command *exec.Cmd)     { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func processAlive(pid int) bool    { return pid > 1 && syscall.Kill(pid, 0) == nil }
func terminate(owned *child) error { return owned.command.Process.Signal(syscall.SIGTERM) }
func verifyListener(pid int, binary, address string) error {
	if pid <= 1 {
		return errors.New("invalid owner")
	}
	actual, err := os.Stat(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return err
	}
	expected, err := os.Stat(binary)
	if err != nil || !os.SameFile(actual, expected) {
		return errors.New("runtime executable identity changed")
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		return errors.New("invalid runtime listener")
	}
	number, err := strconv.Atoi(port)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/net/tcp", pid))
	if err != nil {
		return err
	}
	wanted := fmt.Sprintf("0100007F:%04X", number)
	sockets := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 9 && fields[1] == wanted && fields[3] == "0A" {
			sockets["socket:["+fields[9]+"]"] = true
		}
	}
	entries, err := os.ReadDir(fmt.Sprintf("/proc/%d/fd", pid))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		target, _ := os.Readlink(fmt.Sprintf("/proc/%d/fd/%s", pid, entry.Name()))
		if sockets[target] {
			return nil
		}
	}
	return errors.New("listener does not belong to the started runtime")
}
