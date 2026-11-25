package main

import (
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func introductionAction(stateDir string, store config.Store, a personalization.CatalogAction) (result personalization.CatalogResult) {
	result.RequestID = a.RequestID
	fail := func(err error) personalization.CatalogResult { result.Error = err.Error(); return result }
	release, err := lockIntroduction(stateDir)
	if err != nil {
		return fail(err)
	}
	defer release()
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
	case "intro_start":
		if settings.Desktop.Introduction != "" {
			break
		}
		if a.ConversationID == "" {
			return fail(errors.New("open a chat before starting your introduction"))
		}
		revision, err := memories.IntroductionRevision()
		if err != nil {
			return fail(err)
		}
		records, err := memories.List("", false)
		if err != nil {
			return fail(err)
		}
		known := map[string]bool{}
		for _, record := range records {
			if record.GoalID == "" && record.Recallable() {
				known[memory.CanonicalSubject(record.Subject)] = true
			}
		}
		question := ""
		switch {
		case !known["profile.name"]:
			question = "What should I call you?"
		case !known["preference.tone"]:
			question = "How would you like me to chat with you—casual, concise, detailed, or something else?"
		case !known["profile.projects"]:
			question = "What are you working on, or what would you like help with?"
		}
		greeting := "Hey, I’m Hot Cross Buns. I’d like to get to know you a little so I can be more useful. " + question + " You can skip this whenever you like. I’ll collect your answers and check with you before remembering them together."
		if err := store.Update(func(s *config.Settings) error {
			if s.Desktop.Introduction != "" {
				return nil
			}
			if question == "" {
				s.Desktop.Introduction = "completed"
				return nil
			}
			s.Desktop.Introduction = "started"
			s.Desktop.IntroductionChat = &config.IntroductionChat{ConversationID: a.ConversationID, StartedAt: time.Now().UTC(), Greeting: greeting, Revision: revision}
			return nil
		}); err != nil {
			return fail(err)
		}
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
			if s.Desktop.IntroductionChat != nil {
				copy := *s.Desktop.IntroductionChat
				copy.Proposal = nil
				s.Desktop.IntroductionChat = &copy
			}
			return nil
		}); err != nil {
			return fail(err)
		}
		if _, err := personalization.SyncMarkdown(stateDir); err != nil {
			return fail(err)
		}
	case "intro_skip":
		if err := store.Update(func(s *config.Settings) error {
			s.Desktop.Introduction = "skipped"
			if s.Desktop.IntroductionChat != nil {
				copy := *s.Desktop.IntroductionChat
				copy.Proposal = nil
				s.Desktop.IntroductionChat = &copy
			}
			return nil
		}); err != nil {
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
		if !record.Recallable() || record.GoalID != "" {
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

func lockIntroduction(stateDir string) (func(), error) {
	path := filepath.Join(stateDir, "hot-cross-buns")
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := filelock.OpenRootFile(root, ".introduction.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := filelock.Lock(file, filelock.Exclusive); err != nil {
		file.Close()
		return nil, err
	}
	return func() { _ = filelock.Unlock(file); _ = file.Close() }, nil
}
