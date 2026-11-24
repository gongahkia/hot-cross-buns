package sandbox

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
)

// prepareLinux uses Bubblewrap. It exposes standard runtime directories
// read-only and binds only approved writable roots. Strict mode therefore
// fails closed when Bubblewrap is not installed or cannot create a namespace.
func prepareLinux(ctx context.Context, root, scratch string, argv, environment []string, policy Policy) (*exec.Cmd, error) {
	bwrap, err := exec.LookPath("bwrap")
	if err != nil {
		return nil, errors.New("strict sandbox requires bubblewrap (bwrap) on Linux")
	}
	readRoots, writeRoots, err := sandboxRoots(root, scratch, policy)
	if err != nil {
		return nil, err
	}
	readRoots = append(readRoots, commandRuntimeRoots(argv)...)
	// systemd-resolved keeps the resolver behind /etc/resolv.conf in /run.
	// mount only its target file, never the surrounding runtime directory.
	if policy.Network == AllowNetwork {
		resolver, err := filepath.EvalSymlinks("/etc/resolv.conf")
		if err != nil {
			return nil, err
		}
		if resolver != "/etc/resolv.conf" && !strings.HasPrefix(resolver, "/etc/") {
			readRoots = append(readRoots, resolver)
		}
	}
	readRoots = removeWritableRoots(readRoots, writeRoots)
	arguments := []string{"--die-with-parent", "--new-session", "--unshare-all", "--proc", "/proc", "--dev", "/dev"}
	// --unshare-all includes the network namespace. AllowNetwork must undo
	// that isolation explicitly; omitting --unshare-net does not restore it.
	if policy.Network == AllowNetwork {
		arguments = append(arguments, "--share-net")
	}
	for _, directory := range []string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"} {
		if exists(directory) {
			arguments = append(arguments, "--ro-bind", directory, directory)
		}
	}
	for _, directory := range readRoots {
		arguments = append(arguments, "--ro-bind", directory, directory)
	}
	for _, directory := range writeRoots {
		arguments = append(arguments, "--bind", directory, directory)
	}
	if policy.LiveFiles != nil {
		for _, protected := range policy.LiveFiles.Protected {
			if exists(protected) {
				arguments = append(arguments, "--tmpfs", protected)
			}
		}
		// Restore only this process's private checkout, scratch and private HOME.
		for _, allowed := range append([]string{root, scratch}, policy.WritableRoots...) {
			arguments = append(arguments, "--bind", allowed, allowed)
		}
	}
	if policy.Network == DenyNetwork {
		arguments = append(arguments, "--unshare-net")
	}
	arguments = append(arguments, "--chdir", root, "--", argv[0])
	arguments = append(arguments, argv[1:]...)
	command := exec.CommandContext(ctx, bwrap, arguments...)
	command.Dir = root
	command.Env = runtimeEnvironment(environment, readRoots)
	return command, nil
}

func exists(path string) bool {
	_, err := osStat(path)
	return err == nil
}

func removeWritableRoots(readRoots, writeRoots []string) []string {
	writable := make(map[string]struct{}, len(writeRoots))
	for _, root := range writeRoots {
		writable[root] = struct{}{}
	}
	result := make([]string, 0, len(readRoots))
	for _, root := range readRoots {
		if _, exists := writable[root]; !exists {
			result = append(result, root)
		}
	}
	return result
}
