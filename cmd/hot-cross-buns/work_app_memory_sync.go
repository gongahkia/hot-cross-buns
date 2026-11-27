package main

import (
	"context"
	"errors"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/memorysync"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func (c hotCrossBunsAppController) inspectMemorySync() (any, error) {
	settings, err := c.settings.Load()
	if err != nil {
		return nil, err
	}
	report, err := (memorysync.Store{StateDir: c.stateDir, Folder: settings.MemorySync.Folder}).Status()
	if err != nil {
		return nil, err
	}
	return map[string]any{"configured": settings.MemorySync.Folder != "", "enabled": settings.MemorySync.Enabled, "last_checked": report.LastRun, "delivery": report.Delivery, "imported_devices": report.ImportedDevices, "conflicts": len(report.Conflicts), "issues": report.Issues, "settings_revision": memorySyncRevision(settings.MemorySync), "scope": "Only saved reference data is synced. Credentials, device permissions, models and running tasks remain local. Files received by Syncthing are not confirmation that another HCB imported them."}, nil
}
func (c hotCrossBunsAppController) prepareMemorySync(change workrun.AppChange) (workrun.AppMutation, error) {
	var value struct {
		Action   string `json:"action"`
		Expected string `json:"expected_revision"`
	}
	if err := workrun.DecodeAppArguments(change.Value, &value); err != nil {
		return workrun.AppMutation{}, err
	}
	settings, err := c.settings.Load()
	if err != nil {
		return workrun.AppMutation{}, err
	}
	prior := settings.MemorySync
	if prior.Folder == "" {
		return workrun.AppMutation{}, errors.New("connect an existing Syncthing folder in Settings → Memory & privacy → Device sync first; never request API keys in chat")
	}
	if value.Action == "run" {
		return workrun.AppMutation{Summary: "Memory sync checked; report delivery status, conflicts and any remaining issues.", Apply: func(ctx context.Context) (any, error) {
			current, err := c.settings.Load()
			if err != nil {
				return nil, err
			}
			if current.MemorySync != prior {
				return nil, errors.New("sync settings changed; inspect them again")
			}
			report, err := memorysync.Synchronize(ctx, c.stateDir, prior)
			if err != nil {
				return nil, err
			}
			return map[string]any{"delivery": report.Delivery, "published": report.Published, "imported": report.Imported, "imported_devices": report.ImportedDevices, "conflicts": len(report.Conflicts), "issues": report.Issues}, nil
		}}, nil
	}
	if value.Action != "pause" && value.Action != "resume" {
		return workrun.AppMutation{}, errors.New("memory_sync action must be run, pause or resume; connection setup stays in Settings")
	}
	if value.Expected != memorySyncRevision(prior) {
		return workrun.AppMutation{}, errors.New("inspect current memory sync settings before changing them")
	}
	enabled := value.Action == "resume"
	return workrun.AppMutation{Review: enabled, Summary: "Memory sync preference updated.", Preview: map[string]any{"setting": "memory_sync", "enabled": enabled, "effect": "Resume or pause the already connected memory folder. This does not pair devices or change tool permissions."}, Apply: func(context.Context) (any, error) {
		err := c.settings.Update(func(current *config.Settings) error {
			if current.MemorySync != prior {
				return errors.New("memory sync settings changed")
			}
			current.MemorySync.Enabled = enabled
			return nil
		})
		return map[string]any{"enabled": enabled}, err
	}}, nil
}
