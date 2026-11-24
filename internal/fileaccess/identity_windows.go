//go:build windows

package fileaccess

import (
	"errors"
	"os"
)

func folderIdentity(string) (string, error) {
	return "", errors.New("live filesystem permissions are not available on Windows in this build")
}

func identityInfo(os.FileInfo) string { return "" }
