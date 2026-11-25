package main

import (
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"strings"
	"time"
)

func introductionAction(stateDir string, store config.Store, a personalization.CatalogAction) (result personalization.CatalogResult) {
	result.RequestID = a.RequestID
	fail := func(err error) personalization.CatalogResult { result.Error = err.Error(); return result }
	settings, err := store.Load()
	if err != nil {
		return fail(err)
	}
	if len(a.Timezone) > 128 {
		return fail(errors.New("choose a valid timezone"))
	}
	if a.Timezone != "" {
		if _, err := time.LoadLocation(a.Timezone); err != nil {
			return fail(errors.New("choose a valid timezone"))
		}
	}
	memories, err := memory.Open(stateDir)
	if err != nil {
		return fail(err)
	}
	switch a.Action {
	case "intro_status":
		if a.Timezone != "" && settings.JobDefaults.Timezone == "Local" {
			if err := store.Update(func(s *config.Settings) error {
				if s.JobDefaults.Timezone == "Local" {
					s.JobDefaults.Timezone = a.Timezone
				}
				return nil
			}); err != nil {
				return fail(err)
			}
		}
	case "intro_save":
		if a.Timezone == "" {
			return fail(errors.New("choose a timezone"))
		}
		fields := map[string]string{}
		if strings.TrimSpace(a.Name) != "" {
			fields["profile.name"] = "Name: " + strings.TrimSpace(a.Name)
		}
		if strings.TrimSpace(a.Style) != "" {
			fields["preference.tone"] = "Reply style: " + strings.TrimSpace(a.Style)
		}
		if strings.TrimSpace(a.PersonalContext) != "" {
			fields["profile.projects"] = strings.TrimSpace(a.PersonalContext)
		}
		if err := memories.SaveIntroduction(fields, a.Revision); err != nil {
			return fail(err)
		}
		if err := store.Update(func(s *config.Settings) error {
			s.JobDefaults.Timezone = a.Timezone
			s.Desktop.Introduction = "completed"
			return nil
		}); err != nil {
			return fail(err)
		}
		if _, err := personalization.SyncMarkdown(stateDir); err != nil {
			return fail(err)
		}
	case "intro_skip":
		if err := store.Update(func(s *config.Settings) error { s.Desktop.Introduction = "skipped"; return nil }); err != nil {
			return fail(err)
		}
	default:
		return fail(errors.New("unsupported introduction action"))
	}
	settings, err = store.Load()
	if err != nil {
		return fail(err)
	}
	revision, err := memories.IntroductionRevision()
	if err != nil {
		return fail(err)
	}
	intro := &personalization.Introduction{Status: settings.Desktop.Introduction, Timezone: settings.JobDefaults.Timezone, Revision: revision}
	records, err := memories.List("", false)
	if err != nil {
		return fail(err)
	}
	for _, record := range records {
		if !record.Recallable() {
			continue
		}
		if record.Subject == "profile.name" {
			intro.NameKnown = true
		}
		if record.Subject == "preference.tone" {
			intro.StyleKnown = true
		}
		if memory.CanonicalSubject(record.Subject) == "profile.projects" {
			intro.ContextKnown = true
		}
	}
	result.Introduction = intro
	return result
}
