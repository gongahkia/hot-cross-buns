# TODO

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
