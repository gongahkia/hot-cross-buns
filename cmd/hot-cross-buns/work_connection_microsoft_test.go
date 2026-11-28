package main

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestMicrosoftDeviceSignInStoresCredentialPrivately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		w.Header().Set("Content-Type", "application/json")
		if r.Form.Get("client_id") != "public-client" {
			t.Error("wrong public client")
		}
		switch r.URL.Path {
		case "/devicecode":
			io.WriteString(w, `{"device_code":"private-device-code","user_code":"ABCD-EFGH","verification_uri":"https://microsoft.com/devicelogin","expires_in":600,"interval":1}`)
		case "/token":
			if r.Form.Get("device_code") != "private-device-code" {
				t.Error("wrong device code")
			}
			io.WriteString(w, `{"access_token":"private-access","refresh_token":"private-refresh","expires_in":3600}`)
		default:
			t.Error("unexpected endpoint")
		}
	}))
	defer server.Close()
	root, _, credentials := nativeConnectionFixture(t, server.URL)
	d := connector.Descriptor{Version: 1, ID: "microsoft", Name: "Microsoft", Kind: connector.KindMicrosoft365, Resource: server.URL, Authentication: connector.AuthOAuth, OAuthClientID: "public-client", OAuthAuthorizeURL: server.URL + "/authorize", OAuthTokenURL: server.URL + "/token", OAuthRedirectURL: "http://127.0.0.1:0/oauth/callback", OAuthScopes: connector.MicrosoftReadScopes}
	if e := addNativeConnection(d); e != nil {
		t.Fatal(e)
	}
	c := &connectionControls{stateDir: root}
	if _, e := c.call(context.Background(), "signin", []string{d.ID, connectorLoginReview(d), ""}); e != nil {
		t.Fatal(e)
	}
	if c.signIn.Status().UserCode != "ABCD-EFGH" {
		t.Fatal("private UI missing user code")
	}
	status := finishNativeSignIn(t, &c.signIn)
	if status.Issue != "" || status.UserCode != "" {
		t.Fatal(status)
	}
	saved, found, e := credentials.Read(d.CredentialRef())
	if e != nil || !found || saved.Access != "private-access" || saved.Refresh != "private-refresh" || !saved.IsOAuth() {
		t.Fatal("credential not saved privately", e)
	}
}

func TestRemoteMCPPrivateOAuthBindsResourceAndPKCE(t *testing.T) {
	root, _, _ := nativeConnectionFixture(t, "https://example.com")
	d := connector.Descriptor{Version: 1, ID: "remote", Name: "Remote", Kind: connector.KindRemoteMCP, Resource: "https://mcp.example.com/mcp", Authentication: connector.AuthOAuth, ReadTool: "lookup", OAuthClientID: "public", OAuthAuthorizeURL: "https://auth.example.com/authorize", OAuthTokenURL: "https://auth.example.com/token", OAuthRedirectURL: "http://127.0.0.1:0/callback", OAuthScopes: "read"}
	if e := addNativeConnection(d); e != nil {
		t.Fatal(e)
	}
	s := &connectionSignIn{}
	status, e := s.Begin(root, d.ID, connectorLoginReview(d), "")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Cancel(d.ID)
	u, e := url.Parse(status.URL)
	if e != nil || u.Query().Get("resource") != d.Resource || u.Query().Get("code_challenge_method") != "S256" {
		t.Fatal("MCP OAuth lost resource or PKCE", e)
	}
}
