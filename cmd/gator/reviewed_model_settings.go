package main

import (
	"errors"
	"github.com/gongahkia/gator/internal/config"
	"reflect"
)

// The network/discovery step is complete before entering this fresh locked update.
func updateReviewedProvider(store config.Store, expected config.Settings, id string, change func(*config.Settings)) error {
	old, existed := configuredCustomProvider(expected, id)
	return store.Update(func(current *config.Settings) error {
		now, exists := configuredCustomProvider(*current, id)
		if exists != existed || !reflect.DeepEqual(old, now) || current.Defaults != expected.Defaults || !reflect.DeepEqual(current.WorkRoles, expected.WorkRoles) || !reflect.DeepEqual(current.ModelAliases, expected.ModelAliases) {
			return errors.New("reviewed provider configuration changed; inspect and review again")
		}
		change(current)
		return nil
	})
}
