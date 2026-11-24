package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
)

func TestCalendarConsentPublishesOnlyAfterConfirmedGrant(t *testing.T) {
	for _, mode := range []string{"read", "write"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "new-access", "refresh_token": "new-refresh", "token_type": "Bearer", "expires_in": 3600, "scope": "openid " + connector.GoogleDailyOAuthScopes + " " + connector.GoogleCalendarReadScope + " " + connector.GoogleCalendarWriteScope})
			}))
			defer server.Close()
			root, d, credentials := nativeConnectionFixture(t, server.URL)
			old := auth.Credential{Type: "oauth", Access: "old-private-access", Refresh: "old-private-refresh"}
			if err := credentials.Put(d.CredentialRef(), old); err != nil {
				t.Fatal(err)
			}
			controls := &connectionControls{stateDir: root}
			t.Cleanup(func() { controls.signIn.Cancel(d.ID) })
			screen, err := controls.screen(d.ID)
			if err != nil {
				t.Fatal(err)
			}
			op := "enable-calendar-reading"
			if mode == "write" {
				op = "enable-calendar-changes"
			}
			enable := sendingControl(t, screen, op)
			if !enable.Review || !strings.Contains(enable.Description, connector.GoogleCalendarReadScope) {
				t.Fatal("calendar permission is not reviewable")
			}
			serialized, _ := json.Marshal(screen)
			if strings.Contains(string(serialized), old.Access) || strings.Contains(string(serialized), old.Refresh) {
				t.Fatal("credential leaked in calendar review")
			}
			if _, err := controls.call(context.Background(), op, append(enable.Args, "")); err != nil {
				t.Fatal(err)
			}
			status := controls.signIn.Status()
			u, _ := url.Parse(status.URL)
			scopes := strings.Fields(u.Query().Get("scope"))
			if !slices.Contains(scopes, connector.GoogleCalendarReadScope) || slices.Contains(scopes, connector.GoogleCalendarWriteScope) != (mode == "write") {
				t.Fatal("wrong requested calendar scopes", scopes)
			}
			before, _, _ := configuredConnector(d.ID)
			if connectorLoginReview(before) != connectorLoginReview(d) || calls != 0 {
				t.Fatal("calendar exposed before consent")
			}
			authorizeNativeSignIn(t, status)
			done := finishNativeSignIn(t, &controls.signIn)
			if done.Issue != "" {
				t.Fatal(done.Issue)
			}
			after, _, _ := configuredConnector(d.ID)
			credential, _, _ := credentials.Read(d.CredentialRef())
			if !strings.Contains(after.OAuthScopes, connector.GoogleCalendarReadScope) || credential.Access != "new-access" {
				t.Fatal("confirmed calendar grant not published")
			}
			if mode == "write" {
				screen, err = controls.screen(d.ID)
				if err != nil {
					t.Fatal(err)
				}
				disable := sendingControl(t, screen, "disable-calendar-changes")
				if _, err := controls.call(context.Background(), disable.Action, disable.Args); err != nil {
					t.Fatal(err)
				}
				after, _, _ = configuredConnector(d.ID)
				if strings.Contains(after.OAuthScopes, connector.GoogleCalendarWriteScope) || !strings.Contains(after.OAuthScopes, connector.GoogleCalendarReadScope) {
					t.Fatal("local write disable lost read access")
				}
			}
			screen, err = controls.screen(d.ID)
			if err != nil {
				t.Fatal(err)
			}
			disable := sendingControl(t, screen, "disable-calendar-access")
			if _, err := controls.call(context.Background(), disable.Action, disable.Args); err != nil {
				t.Fatal(err)
			}
			after, _, _ = configuredConnector(d.ID)
			remaining, _, _ := credentials.Read(d.CredentialRef())
			if strings.Contains(after.OAuthScopes, "/auth/calendar") || !strings.Contains(after.OAuthScopes, connector.GoogleDailyOAuthScopes) || !reflect.DeepEqual(remaining, credential) || calls != 1 {
				t.Fatal("calendar disable changed unrelated account access")
			}
		})
	}
}

func TestCalendarPartialConsentKeepsOriginalAccount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "partial", "refresh_token": "partial-refresh", "token_type": "Bearer", "expires_in": 3600, "scope": "openid " + connector.GoogleDailyOAuthScopes})
	}))
	defer server.Close()
	root, d, credentials := nativeConnectionFixture(t, server.URL)
	old := auth.Credential{Type: "oauth", Access: "old-private", Refresh: "old-refresh"}
	if err := credentials.Put(d.CredentialRef(), old); err != nil {
		t.Fatal(err)
	}
	signin := &connectionSignIn{}
	t.Cleanup(func() { signin.Cancel(d.ID) })
	status, err := signin.EnableCalendar(root, d.ID, connectorLoginReview(d), credentialReview(&old), "", "write")
	if err != nil {
		t.Fatal(err)
	}
	authorizeNativeSignIn(t, status)
	if finishNativeSignIn(t, signin).Issue == "" {
		t.Fatal("partial Calendar consent accepted")
	}
	after, _, _ := configuredConnector(d.ID)
	saved, _, _ := credentials.Read(d.CredentialRef())
	if connectorLoginReview(after) != connectorLoginReview(d) || !reflect.DeepEqual(saved, old) {
		t.Fatal("failed calendar consent replaced original account")
	}
}

func TestCalendarPermissionModePreservesOtherServicesAndRejectsInvalidMode(t *testing.T) {
	d := connector.Descriptor{Kind: connector.KindGoogle, Authentication: connector.AuthOAuth, OAuthScopes: "openid " + connector.GoogleDailyOAuthScopes + " " + connector.GoogleSendOAuthScope}
	next, err := calendarDescriptor(d, "write")
	if err != nil || !strings.Contains(next.OAuthScopes, connector.GoogleSendOAuthScope) {
		t.Fatal(next, err)
	}
	if _, err := calendarDescriptor(d, "all"); err == nil {
		t.Fatal("unknown calendar permission mode accepted")
	}
	for _, mode := range []string{"read", "off"} {
		narrow, err := calendarDescriptor(next, mode)
		if err != nil || strings.Contains(narrow.OAuthScopes, connector.GoogleCalendarWriteScope) {
			t.Fatal("calendar write access retained", narrow, err)
		}
	}
}
