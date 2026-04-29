# TODO

## Withdraw Google OAuth Verification Request

- Reply to the Google OAuth Verification Team email for project `34172550804` / `hot-cross-buns-493806`.
- Tell Google that this OAuth verification request should be closed or withdrawn because Hot Cross Buns no longer uses Gabriel's Google Cloud project as the public OAuth client for distributed users.
- Use this reply:

```text
Hello Google OAuth Verification Team,

Thank you for the review. I am no longer requesting verification for this OAuth app for public user access.

Hot Cross Buns is being changed so that distributed users configure and use their own Google Cloud OAuth desktop client. My Google Cloud project will only be used for my own personal installation/testing.

Please close or withdraw this verification request for project 34172550804 / hot-cross-buns-493806.

Thank you.
```

- Do not spend time fixing the rejected verification items unless public verification is needed again:
  - Domain ownership for `gabrielongzm.com`.
  - Privacy-policy review submission details.
  - Demo video showing OAuth consent and app functionality.
- Keep the privacy policy accurate anyway, because BYO OAuth users may still read it.

## Live Test Runtime Google OAuth

- Create a Google Cloud project for live testing.
- Enable the Google Tasks API and Google Calendar API.
- Configure the Google Auth platform / OAuth consent screen:
  - Audience: External for a personal Gmail account.
  - Add the test Google account while the app is in Testing.
  - Use In production for daily use if you want to avoid the 7-day testing-mode refresh-token expiry.
- Create a Google Cloud OAuth client with application type `Desktop app`.
- Build or install a DMG that does not rely on embedded Google OAuth values.
- Launch Hot Cross Buns and open the Google OAuth client setup card in onboarding or Settings.
- Paste the Desktop OAuth client ID and optional client secret, then save.
- Click Connect Google and complete the browser consent flow.
- Confirm the localhost callback returns to the app and the account shows as connected with Tasks + Calendar scopes.
- Refresh sync and verify task lists, tasks, calendars, and events load.
- Quit and relaunch the app, then confirm session restore works without re-consent.
- Wait for or force an access-token refresh path, then confirm sync still works from the stored refresh token.
- Clear the custom OAuth client in Settings and confirm the app disconnects/returns to the signed-out setup state.
