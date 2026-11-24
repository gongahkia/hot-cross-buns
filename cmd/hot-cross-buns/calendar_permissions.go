package main

import (
	"errors"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

func calendarDescriptor(d connector.Descriptor, mode string) (connector.Descriptor, error) {
	if d.Kind != connector.KindGoogle || d.Authentication != connector.AuthOAuth {
		return d, errors.New("calendar permissions require a Google browser connection")
	}
	if mode != "off" && mode != "read" && mode != "write" {
		return d, errors.New("choose read, write or off calendar access")
	}
	scopes := []string{}
	for _, scope := range strings.Fields(d.OAuthScopes) {
		if scope != "https://www.googleapis.com/auth/calendar" && !strings.HasPrefix(scope, "https://www.googleapis.com/auth/calendar.") {
			scopes = append(scopes, scope)
		}
	}
	if mode != "off" {
		scopes = append(scopes, connector.GoogleCalendarReadScope)
	}
	if mode == "write" {
		scopes = append(scopes, connector.GoogleCalendarWriteScope)
	}
	next := strings.Join(scopes, " ")
	if next == strings.Join(strings.Fields(d.OAuthScopes), " ") {
		return d, errors.New("calendar permissions already match; refresh the connection")
	}
	d.OAuthScopes = next
	return d, nil
}

func calendarPermissionActions(d connector.Descriptor, review []string, connected bool) []workapp.ControlAction {
	if !connected || d.Kind != connector.KindGoogle || d.Authentication != connector.AuthOAuth {
		return nil
	}
	read, write := false, false
	for _, op := range d.Operations() {
		if op.ID == "calendar_events" {
			read = true
		}
		if op.ID == "calendar_event_create" {
			write = true
		}
	}
	var actions []workapp.ControlAction
	add := func(key, label, operation, mode string) {
		next, err := calendarDescriptor(d, mode)
		if err != nil {
			return
		}
		a := workapp.ControlAction{Key: key, Label: label, Action: operation, Args: append([]string(nil), review...), Review: true, Description: "Sign in again to review calendar access alongside existing permissions. The previous account stays configured if consent fails. Select the account per chat or follow-up. Each event change requires exact approval. Requested permissions: " + next.OAuthScopes, Fields: []workapp.ControlField{{Label: "OAuth client secret (optional)", Secret: true, Help: "Leave blank to keep the stored secret for your desktop OAuth client."}}, Links: []uisnapshot.Link{{Label: "Google Calendar permissions", URL: "https://developers.google.com/workspace/calendar/api/auth"}}}
		if usesBundledGoogle(d) {
			a.Fields = nil
			a.Args = append(a.Args, "")
		}
		actions = append(actions, a)
	}
	if !read {
		add("K", "Enable calendar reading", "enable-calendar-reading", "read")
	}
	if !write {
		add("W", "Enable calendar changes", "enable-calendar-changes", "write")
	} else {
		actions = append(actions, workapp.ControlAction{Key: "W", Label: "Turn off calendar changes", Action: "disable-calendar-changes", Args: append([]string(nil), review...), Review: true, Description: "Keep calendar reading but remove event changes for new tasks. Already submitted tasks keep their captured permissions. Revoke Google's grant in account settings for service-side revocation."})
	}
	if read || write {
		actions = append(actions, workapp.ControlAction{Key: "X", Label: "Turn off calendar access", Action: "disable-calendar-access", Args: append([]string(nil), review...), Review: true, Description: "Remove calendar access for new tasks while retaining other account features. Already submitted tasks keep their captured permissions. Revoke the grant in Google account settings to stop service-side access."})
	}
	return actions
}
