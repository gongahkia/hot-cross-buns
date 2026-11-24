//go:build !windows

package fileaccess

import (
	"fmt"
	"os"
	"syscall"
)

func identityInfo(info os.FileInfo) string {
	stat := info.Sys().(*syscall.Stat_t)
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
}
func folderIdentity(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	return identityInfo(info), nil
}
