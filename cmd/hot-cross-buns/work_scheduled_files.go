package main

import (
	"errors"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func scheduledFilesCheck(stateDir string, request workrun.Request) func() error {
	return func() error {
		if request.DecisionOrigin != "job" {
			return errors.New("scheduled folder grants require a scheduler-owned request")
		}
		store, err := jobs.Open(stateDir)
		if err != nil {
			return err
		}
		definition, err := store.Load(request.ScheduledJobID)
		if err != nil {
			return err
		}
		digest, err := definition.CheckPolicyDigest()
		if err != nil {
			return err
		}
		if !definition.Enabled || digest != request.ScheduledJobPolicy || (!definition.EndsAt.IsZero() && !definition.EndsAt.After(time.Now())) {
			return errors.New("scheduled job was paused, expired or changed; review its folder scope again")
		}
		return nil
	}
}
