package main

import (
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/state"
)

func preparePlatformProfile() error {
	root, err := state.ResolveDir("")
	if err != nil {
		return err
	}
	if err := privatefs.MkdirAll(filepath.Join(root, "hot-cross-buns")); err != nil {
		return err
	}
	configuration, err := config.ResolveDir("")
	if err != nil {
		return err
	}
	if err := privatefs.MkdirAll(filepath.Join(configuration, "hot-cross-buns")); err != nil {
		return err
	}
	if drafts := os.Getenv("HOT_CROSS_BUNS_DESKTOP_DRAFT_DIR"); drafts != "" {
		return privatefs.MkdirAll(drafts)
	}
	return nil
}
