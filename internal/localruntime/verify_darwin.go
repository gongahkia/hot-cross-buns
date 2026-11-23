//go:build darwin

package localruntime

import (
	"context"
	"errors"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func detach(command *exec.Cmd)     { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func processAlive(pid int) bool    { return pid > 1 && syscall.Kill(pid, 0) == nil }
func terminate(owned *child) error { return owned.command.Process.Signal(syscall.SIGTERM) }
func verifyListener(pid int, binary, address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" || pid <= 1 {
		return errors.New("invalid owner listener")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "/usr/sbin/lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-iTCP@127.0.0.1:"+port, "-sTCP:LISTEN", "-Fpn").Output()
	if err != nil || !strings.Contains(string(data), "p"+strconv.Itoa(pid)+"\n") || !strings.Contains(string(data), "n"+address+"\n") {
		return errors.New("listener owner could not be verified")
	}
	data, err = exec.CommandContext(ctx, "/usr/sbin/lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-d", "txt", "-Fn").Output()
	if err != nil || !strings.Contains(string(data), "n"+binary+"\n") {
		return errors.New("executable owner could not be verified")
	}
	return nil
}
