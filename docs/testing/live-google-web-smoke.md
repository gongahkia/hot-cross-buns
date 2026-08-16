# Web PWA live Google smoke test

Run this manual check against a disposable Google account and a user-owned Google Cloud project. Do not commit client IDs, secrets, account data, request logs, screenshots containing personal data, or browser-storage exports.

1. Deploy `web/dist` to a static HTTPS origin, then create a Google OAuth **Web application** client with that origin and the local development origin in Authorized JavaScript origins.
2. Enable Tasks, Calendar, and Drive APIs. Configure the consent screen and add the disposable account as a test user when applicable.
3. Open the PWA in a fresh browser profile, enter the client ID, and authorize Tasks and Calendar. Confirm no client-secret field exists.
4. Create, complete, and edit disposable Google Tasks. Reload the app and confirm cached tasks appear before reconnecting; click Sync and verify the Google browser view matches.
5. Create a disposable Calendar event with time zone, attendees, optional Meet, and a Drive attachment. Confirm the Calendar browser view matches.
6. Authorize Drive metadata from the attachment picker, search for a disposable Drive file, attach it, and confirm no file-content preview or upload occurs.
7. Disconnect Google, confirm the page no longer has an active token, then clear browser-local data and confirm the client ID and cached entities are removed.
8. Let the token expire or revoke consent in Google Account settings. Confirm a visible user action is required to reconnect and cached data is not silently sent until authorization succeeds.
