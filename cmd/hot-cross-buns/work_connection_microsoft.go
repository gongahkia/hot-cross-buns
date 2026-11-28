package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
)

func (s *connectionSignIn) beginMicrosoft(d connector.Descriptor, credentials auth.Store, expected *auth.Credential, digest string, release func()) (connectionSignInStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active != nil && !s.active.done {
		return connectionSignInStatus{}, errors.New("finish or cancel the current sign-in first")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	flow := auth.DeviceFlow{ClientID: d.OAuthClientID, DeviceCodeURL: strings.TrimSuffix(d.OAuthTokenURL, "/token") + "/devicecode", TokenURL: d.OAuthTokenURL, Scope: d.OAuthScopes, WaitBeforePoll: true}
	authorization, err := flow.Start(ctx)
	if err != nil {
		cancel()
		return connectionSignInStatus{}, errors.New("Microsoft device sign-in could not start; check the public client ID and enable device-code flows")
	}
	next := &connectionSignInAttempt{id: d.ID, url: authorization.VerificationURL, userCode: authorization.UserCode, cancel: cancel}
	s.active = next
	go func() {
		defer release()
		defer cancel()
		token, err := flow.PollToken(ctx, authorization)
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.active != next {
			return
		}
		next.done = true
		next.url = ""
		next.userCode = ""
		if ctx.Err() != nil || err != nil {
			next.issue = "Microsoft sign-in did not complete. It may have expired, been cancelled or been denied. The previous credential is kept."
			return
		}
		current, _, err := configuredConnector(d.ID)
		if err != nil || connectorLoginReview(current) != digest {
			next.issue = "Connection changed during sign-in; review it and try again."
			return
		}
		credential := auth.Credential{Type: "oauth", Access: token.Access, Refresh: token.Refresh}
		if token.Expires > 0 {
			credential.Expires = time.Now().Add(token.Expires).UnixMilli()
		}
		if err = credentials.ReplaceReviewed(d.CredentialRef(), expected, &credential); err != nil {
			next.issue = "The saved credential changed during sign-in; review the account and try again."
			return
		}
		next.notice = "Microsoft sign-in completed. Check account access, then select this connection for your chat. Changes still require exact approval."
	}()
	return connectionSignInStatus{ID: next.id, URL: next.url, UserCode: next.userCode}, nil
}
