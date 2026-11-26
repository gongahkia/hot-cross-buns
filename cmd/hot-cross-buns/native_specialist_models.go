package main

import (
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"reflect"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
)

type nativeSpecialistReview struct {
	id      string
	expires time.Time
	prior   []config.WorkRole
	next    config.WorkRole
	inherit bool
}

func (b *nativeProviderBackend) specialistAction(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
	result := modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action}
	fail := func(message string) modelcatalog.NativeProviderResult { result.Error = message; return result }
	if a.Action == "specialist_review" {
		b.specialistReview = nil
		settings, err := b.settings.Load()
		if err != nil {
			return fail("Specialist settings could not be read.")
		}
		change := workrun.AppChange{Value: mustSpecialistJSON(a)}
		controller := hotCrossBunsAppController{settings: b.settings, stateDir: b.stateDir}
		if _, err = controller.prepareSpecialistModel(change); err != nil {
			return fail(err.Error())
		}
		next := config.WorkRole{Version: 1, Name: a.Role, Provider: a.Provider, Model: a.ModelID, MaxSteps: a.MaxSteps}
		review := &nativeSpecialistReview{id: providerNonce(), expires: time.Now().Add(5 * time.Minute), prior: settings.WorkRoles, next: next, inherit: a.Inherit}
		if review.id == "" {
			return fail("A review could not be created.")
		}
		b.specialistReview = review
		result.Review = &modelcatalog.NativeProviderReview{ID: review.id, Operation: "specialist", Provider: next.Provider, Model: next.Model, Role: next.Name, MaxSteps: next.MaxSteps}
		return result
	}
	review := b.specialistReview
	b.specialistReview = nil
	if review == nil || a.ReviewID != review.id || time.Now().After(review.expires) {
		return fail("Review this exact specialist assignment again before saving.")
	}
	err := b.settings.Update(func(settings *config.Settings) error {
		if !reflect.DeepEqual(settings.WorkRoles, review.prior) || !review.inherit && !knownAppModel(*settings, config.Defaults{Provider: review.next.Provider, Model: review.next.Model}) {
			return errProviderReviewChanged
		}
		for i, role := range settings.WorkRoles {
			if role.Name == review.next.Name {
				settings.WorkRoles[i] = review.next
				return nil
			}
		}
		settings.WorkRoles = append(settings.WorkRoles, review.next)
		return nil
	})
	if err != nil {
		return fail("Specialist or model settings changed; open a fresh review.")
	}
	result.Confirmed = true
	result.Changed = true
	result.Inventory, _ = b.modelInventory()
	return result
}
func mustSpecialistJSON(a modelcatalog.NativeProviderAction) json.RawMessage {
	data, _ := json.Marshal(map[string]any{"role": a.Role, "provider": a.Provider, "model": a.ModelID, "max_steps": a.MaxSteps, "inherit": a.Inherit})
	return data
}
