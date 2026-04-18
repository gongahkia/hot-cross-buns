# Manual Product TODO

These items require account access, local Xcode setup, certificates, or live-device validation. They cannot be completed safely from repository code alone.

## Google OAuth

- Create or choose a Google Cloud project for Hot Cross Buns.
- Enable the Google Tasks API and Google Calendar API in that project.
- Configure OAuth consent for personal/internal use.
- Create OAuth client IDs for the iOS bundle ID `com.gongahkia.hotcrossbuns` and macOS bundle ID `com.gongahkia.hotcrossbuns.mac`.
- Add local values in `apps/apple/Configuration/GoogleOAuth.xcconfig` based on `GoogleOAuth.example.xcconfig`.
- Verify sign-in, disconnect, reconnect, and incremental scope grant behavior with a real Google account.

## Xcode And iOS Validation

- Install the missing iOS 26.4 platform in Xcode Settings > Components.
- Build the `HotCrossBuns` iOS scheme after the platform is installed.
- Run on an iPhone simulator and at least one real iPhone.
- Validate first-run onboarding, Google redirect handling, background/foreground sync behavior, notification permission prompts, and App Shortcuts handoff behavior.

## Apple Developer Distribution

- Enroll or sign in with the intended Apple Developer account.
- Create/export a Developer ID Application certificate as a `.p12` if website DMG distribution is intended.
- Add these GitHub Actions secrets if release signing should run in CI:
  - `MACOS_DEVELOPER_ID_P12_BASE64`
  - `MACOS_DEVELOPER_ID_P12_PASSWORD`
  - `MACOS_DEVELOPER_ID_APPLICATION`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_TEAM_ID`
  - `APP_SPECIFIC_PASSWORD`
  - `NOTARIZE_MACOS_DMG` set to `1`
- Download the CI DMG and confirm Gatekeeper opens it without unsigned-app warnings.

## Live Product QA

- Dogfood with a real account for at least one workday.
- Verify task create/edit/complete/reopen/delete against Google Tasks web UI.
- Verify event create/edit/delete, all-day event behavior, and popup reminders against Google Calendar web UI.
- Confirm selected task lists/calendars persist across app relaunches and sync cycles.
- Confirm local reminders are neither duplicated nor stale after edits/deletes.

## Product Decisions Still Needed

- Decide whether event attendee support should send Google guest update emails by default, ask every time, or never send automatically.
- Decide the recurrence UI model before adding RRULE editing.
- Decide whether offline failed creates should be optimistic with temporary local IDs or queued without appearing until Google accepts them.
- Decide whether to add a direct App Intent that creates Google data in the background, or keep App Shortcuts as foreground handoffs until offline conflict handling is stronger.
