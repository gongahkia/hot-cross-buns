# Hot Cross Buns Security Hardening Audit

Date: 2026-05-13
Scope: macOS Swift app, share extension, local MCP server, Google OAuth/sync, local persistence, diagnostics, release/install path.
Risk bar: practical personal-app hardening.

## Executive Summary

No critical remote-code-execution or obvious committed-secret issue was found in the reviewed source. The app already has several good security controls: macOS sandboxing, loopback-only OAuth and MCP listeners, OAuth PKCE/state, Keychain-backed tokens, optional AES-GCM cache encryption, app-group inbox filtering, no backend, and no third-party analytics/crash-upload SDK.

The main hardening gaps are local-data and local-agent risks:

- Local backups are written as plaintext JSON even when local cache encryption is enabled.
- MCP `confirmWrites` can be reduced to a two-request programmatic flow because confirmation IDs are issued on non-dry-run attempts.
- MCP HTTP requests have no total request/header/body cap before JSON parsing.
- In-app update downloads do not verify release asset checksums or signatures.
- Custom OAuth credentials use `kSecAttrAccessibleAfterFirstUnlock`, weaker than the app's own MCP/cache-key Keychain posture.

Focused security-surface tests were attempted, but the current workspace did not compile because `MacSidebarShell.swift` / `RouterPath.swift` reference `HCBTransitionMeasurement` while `HCBTransitionProfiler.swift` is not part of the generated Xcode project currently used by `xcodebuild`. This appears related to existing uncommitted work, not to this audit.

## Threat Model

Primary assets:

- Google OAuth refresh/access tokens and custom OAuth client configuration.
- Google Tasks and Calendar data mirrored into local cache, backups, logs, diagnostics, Spotlight, notifications, and MCP responses.
- MCP bearer token and permission mode.
- Local encrypted-cache passphrase-derived key.
- Release/install trust path for unsigned DMGs.

Primary adversaries:

- A local macOS process running as the same user.
- A browser page attempting localhost requests.
- A stale or malicious configured MCP client with a copied bearer token.
- A compromised GitHub release asset or maintainer account.
- A person with filesystem access to Application Support, backups, logs, or exported diagnostics.

Non-goals for this audit:

- Full public-consumer-release compliance.
- Defending against a fully compromised OS or process memory inspection.
- Proving Google-side API sanitization behavior.

## Findings

### Critical

No Critical findings.

### High

#### H-1: Local backups bypass cache encryption

Evidence:

- `LocalCacheStore` encrypts `cache-state.json` and `cache-events.json` only when `encryptionKey` is set: `apps/apple/HotCrossBuns/Services/Persistence/LocalCacheStore.swift:291-300`.
- `LocalBackupService` writes a `BackupEnvelope` containing full `CachedAppState` directly as JSON: `apps/apple/HotCrossBuns/Services/Persistence/LocalBackupService.swift:30-45`.
- Settings describes backups as Application Support files, not encrypted: `apps/apple/HotCrossBuns/Features/Settings/LocalBackupSection.swift:33-39`.
- The privacy page states optional cache encryption uses AES-256-GCM for local cache files: `docs/privacy.html:64`.

Exploit scenario:

A user enables local cache encryption expecting on-disk Google data to be protected. Daily backups or manual backups still contain the mirrored state, pending queue, and workspace data as plaintext JSON under Application Support. A person or process with filesystem access can read old backups even if the active cache is encrypted.

Impact:

Confidentiality loss for tasks, notes, calendar metadata, pending writes, and account/workspace state. This also weakens the privacy claim because users are unlikely to distinguish "cache" from app-managed backups.

Recommended fix:

Encrypt local backups whenever cache encryption is enabled. Reuse the active cache encryption key and wrap the backup payload in the same or a versioned backup envelope. If encryption is disabled, label backup status explicitly as plaintext in UI and privacy docs. Consider a one-time migration that encrypts or purges existing plaintext backups after encryption is enabled.

Verification:

- Add tests that enable cache encryption, run `writeBackup`, and assert the backup file does not decode as plaintext `BackupEnvelope`.
- Add a regression test that encrypted backups restore correctly with the key and fail closed without it.
- Manually enable encryption, run "Back up now", and verify no task title/event summary appears with `strings` or direct JSON decode.

#### H-2: MCP confirmation mode can be bypassed without dry-run preview

Evidence:

- Write authorization issues a new confirmation ID when a non-dry-run write lacks a confirmation ID: `apps/apple/HotCrossBuns/Services/MCP/HCBToolService.swift:489-522`.
- `consumeConfirmation` only checks tool name, canonical arguments, and expiry: `apps/apple/HotCrossBuns/Services/MCP/HCBToolService.swift:536-544`.
- Docs say Confirm writes clients must dry-run and pass back the returned `confirmationId`: `docs/mcp.md:27-30`.

Exploit scenario:

An MCP client with the bearer token sends a real `hcb_delete_event` or `hcb_update_task` call without `dryRun`. The server returns a JSON-RPC error containing `confirmationId`. The same client immediately retries with the same arguments and that ID. No dry-run preview was required, and no human review occurred.

Impact:

The `confirmWrites` permission mode becomes a one-round-trip friction mechanism rather than a real preview/confirmation control. This is especially risky for destructive tools, where docs promise dry-run confirmation.

Recommended fix:

Only mint confirmation IDs in the explicit `dryRun == true` branch. For non-dry-run writes that need confirmation, return `confirmationRequired` without a usable ID. Store a confirmation with a flag proving it came from dry-run, and consider including a hash of the preview payload as well as canonical arguments.

Verification:

- Add MCP tests for each permission mode:
  - `confirmWrites` non-dry-run without prior dry-run returns no `confirmationId`.
  - `confirmWrites` dry-run returns `confirmationId`.
  - Retrying with a confirmation ID minted by dry-run applies.
  - Destructive tools follow the same rule even in `allowWrites`.

### Medium

#### M-1: MCP request parsing has no aggregate size cap

Evidence:

- The MCP listener reads chunks up to 64 KiB but appends indefinitely until the parsed `Content-Length` is satisfied: `apps/apple/HotCrossBuns/Services/MCP/MCPServerController.swift:218-245`.
- `HTTPRequest` trusts `Content-Length` for `totalLength` and does not cap header size, content length, or JSON body size: `apps/apple/HotCrossBuns/Services/MCP/MCPServerController.swift:380-410`.
- Authentication occurs only after the request has been accumulated and parsed: `apps/apple/HotCrossBuns/Services/MCP/MCPServerController.swift:101-125`.

Exploit scenario:

A local process connects to the loopback MCP port and sends a large header or body with a huge `Content-Length`. The app accumulates data before token validation, creating memory pressure or UI degradation.

Impact:

Local denial of service against the app. This is constrained to same-machine clients because the listener binds to loopback, but that is still the exact trust boundary MCP is meant to harden.

Recommended fix:

Define strict constants: max header bytes, max body bytes, max request bytes, and max JSON depth/field count if feasible. Reject over-limit requests with `413 Payload Too Large` before JSON parsing. Apply the cap while accumulating bytes, before `HTTPRequest(data:)` succeeds.

Verification:

- Add tests for over-large headers, over-large `Content-Length`, and bodies above the cap.
- Manually `curl` a body over the cap and verify memory stays stable and response is 413.

#### M-2: In-app update downloads lack checksum/signature verification

Evidence:

- The updater checks GitHub latest release metadata and selects `HotCrossBuns-macOS.dmg` or the first `.dmg`: `apps/apple/HotCrossBuns/Services/Updates/UpdaterController.swift:150-151`, `540-545`.
- It downloads the selected asset to Downloads and marks it ready without fetching or verifying `.sha256`: `apps/apple/HotCrossBuns/Services/Updates/UpdaterController.swift:445-474`, `615-645`, `664-680`.
- The shell installer does verify a `.sha256`, but the checksum is downloaded from the same release URL path: `docs/install-macos-preview.sh:90-107`.
- Release packaging is unsigned by default unless `CODE_SIGN_IDENTITY` is supplied: `scripts/package-macos-dmg.sh:14-21`, `154-187`.

Exploit scenario:

If a GitHub release asset, maintainer token, or release upload path is compromised, the in-app updater will download and present the DMG as ready. The shell installer checksum helps detect accidental corruption, but not a malicious replacement when both DMG and `.sha256` come from the same compromised release.

Impact:

Supply-chain compromise path for users who trust the in-app updater or one-line installer. The current unsigned-DMG model means macOS Gatekeeper friction exists, but users are already instructed how to bypass the first-launch block.

Recommended fix:

For personal hardening, fetch and verify the matching `.sha256` in `UpdaterController` before marking an update ready. For stronger hardening, sign and notarize public DMGs and verify code signature/team ID before guiding install. Longer term, publish detached signatures or signed checksums from a trust root separate from mutable release assets.

Verification:

- Add updater tests where the `.sha256` is missing, mismatched, or matched.
- Manually corrupt a downloaded DMG and verify the app refuses to present it as ready.
- For signed builds, run `codesign --verify --deep --strict`, `spctl --assess`, and verify expected Team ID.

#### M-3: Custom OAuth tokens use weaker Keychain accessibility than other secrets

Evidence:

- Custom OAuth token/client entries are saved with `kSecAttrAccessibleAfterFirstUnlock`: `apps/apple/HotCrossBuns/Services/Auth/CustomGoogleOAuthService.swift:524-536`.
- MCP bearer token uses `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: `apps/apple/HotCrossBuns/Services/MCP/HCBMCPTokenStore.swift:48-57`.
- Cache encryption key uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`: `apps/apple/HotCrossBuns/Services/Persistence/HCBCacheKeychain.swift:31-41`.

Exploit scenario:

OAuth refresh tokens remain accessible according to the weaker class after first unlock and are not marked `ThisDeviceOnly`. If backups or migrations carry Keychain material, or if a same-user local compromise occurs after boot, the token posture is weaker than the app's other security-sensitive secrets.

Impact:

Higher exposure window for long-lived Google refresh tokens and client secret material. This is not an immediate token-read bug by itself because Keychain access control still applies, but the app should keep its strongest posture on the most valuable secret.

Recommended fix:

Use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for custom OAuth token sets and client configuration unless background sync while locked is a hard requirement. If background access is needed, use `AfterFirstUnlockThisDeviceOnly` at minimum. Add a migration that rewrites existing entries with the new accessibility class on next load/save.

Verification:

- Unit-test the Keychain store through a query abstraction, or integration-test with a temporary service name, to assert the accessibility constant.
- Manual migration test: save with old class, launch new build, verify item is rewritten and still loads.

#### M-4: OAuth loopback response reflects unescaped callback error text

Evidence:

- The loopback server inserts the `error` query parameter into the failure page: `apps/apple/HotCrossBuns/Services/Auth/OAuthLoopbackServer.swift:129-141`.
- That value becomes `message = body` and is interpolated directly into HTML: `apps/apple/HotCrossBuns/Services/Auth/OAuthLoopbackServer.swift:217-224`, with the HTML built below that block.
- The listener accepts the first loopback connection and only the caller later validates OAuth `state`: `apps/apple/HotCrossBuns/Services/Auth/CustomGoogleOAuthService.swift:209-215`.

Exploit scenario:

A local page or process races the Google OAuth redirect and calls `http://127.0.0.1:<port>/?error=<markup>`. The browser tab can render attacker-controlled markup in the local callback page. State validation prevents credential acceptance, but the displayed page itself is not safely encoded.

Impact:

Local reflected HTML injection and OAuth-flow confusion. The practical risk is low-to-medium because the listener is ephemeral and loopback-only, but the fix is straightforward and prevents a class of local callback issues.

Recommended fix:

HTML-escape all callback values before interpolation. Prefer a generic failure message that does not include raw provider parameters. Validate `state` inside the loopback server before rendering a success/failure page if the expected state is available there.

Verification:

- Add a unit test for `OAuthLoopbackPage.failure("<script>")` or a server-level callback test that asserts escaped output.
- Add a race test where wrong state returns a generic error page and app rejects the sign-in.

#### M-5: Raw diagnostics redaction is token-focused, not payload-privacy focused

Evidence:

- Raw Google payload logging is opt-in but explicitly stores request/response snippets: `apps/apple/HotCrossBuns/Services/Google/GoogleDiagnostics.swift:80-90`, `223-237`.
- Redaction only masks `ya29.*` and `Bearer ...`: `apps/apple/HotCrossBuns/Services/Google/GoogleDiagnostics.swift:239-243`.
- The diagnostic bundle includes persisted logs after applying only email/token/Bearer redaction: `apps/apple/HotCrossBuns/Services/Logging/DiagnosticBundle.swift:55-65`, `139-151`.
- Settings warns that snippets may include task and event payloads: `apps/apple/HotCrossBuns/Features/Settings/HCBSettingsWindow.swift:405-407`.

Exploit scenario:

A user enables raw diagnostics during troubleshooting and later exports a diagnostic bundle. Task titles, notes, event descriptions, locations, attendee names, Meet links, or third-party URLs can remain in the bundle because the redactor is not field-aware.

Impact:

Accidental disclosure in support issues or shared diagnostic files. The UI warning is honest, so this is not a hidden behavior, but the support bundle is still a likely exfiltration path for sensitive planner data.

Recommended fix:

Keep raw payload logging off by default, but add a second export-time warning when raw snippets are present. Add structured redaction for known Google fields (`summary`, `description`, `notes`, `title`, `location`, `attendees`, `hangoutLink`, `htmlLink`) or omit raw snippets from exported bundles unless the user checks an explicit "include raw payload snippets" option.

Verification:

- Add diagnostic tests with sample task/event payloads and assert sensitive fields are redacted or omitted in exported bundles.
- Verify the in-app copied summary never includes raw payload snippets.

### Low

#### L-1: Markdown-to-Calendar HTML emits unescaped text and unrestricted link schemes

Evidence:

- Markdown link text is inserted unescaped into `<a>` content and URL is only attribute-escaped: `apps/apple/HotCrossBuns/Services/Markdown/MarkdownHTML.swift:105-134`.
- Plain text outside markdown syntax is not HTML-escaped before being sent as Calendar HTML: `apps/apple/HotCrossBuns/Services/Markdown/MarkdownHTML.swift:12-18`.

Exploit scenario:

An event description containing HTML-like text or a link such as `[label](javascript:...)` is converted into Calendar HTML. Google likely sanitizes its supported HTML subset, but the app should not rely on a remote service to clean app-generated HTML.

Impact:

Potential HTML/script injection or phishing markup in Google Calendar clients if upstream sanitization behavior changes or differs between clients.

Recommended fix:

Escape all plain text and link labels before applying inline tags. Restrict link schemes to `https`, `http`, `mailto`, and optionally app-safe deep links. Treat unknown schemes as plain text.

Verification:

- Add tests for `<script>`, `<img onerror>`, quote-breaking link labels, and `javascript:` links.

#### L-2: System crash report reader broadens sandbox entitlements

Evidence:

- Main app entitlement grants temporary read-only access to `~/Library/Logs/DiagnosticReports/`: `apps/apple/HotCrossBuns/Support/HotCrossBuns.entitlements:17-20`.
- Reader lists reports by executable-name prefixes and reads contents as opaque text: `apps/apple/HotCrossBuns/Services/Persistence/SystemCrashReportReader.swift:36-62`.

Exploit scenario:

If prefix matching is too broad, the app may surface unrelated crash reports whose filenames begin with a similar prefix. The current prefix is narrow enough for this app, but the entitlement is still a broad sandbox exception.

Impact:

Low privacy risk and App Store/notarization review friction. It is a support feature, not an exploitable network path.

Recommended fix:

Keep the feature, but add stricter validation by parsing the `.ips` metadata for bundle identifier before displaying contents. Document why the temporary exception is needed and gate display behind explicit user action.

Verification:

- Add tests around prefix filtering.
- Manual test with similarly named crash reports to verify unrelated files are not surfaced.

#### L-3: Share extension duplicate schema can drift

Evidence:

- The main app and share extension carry duplicated `SharedInboxItem` / defaults code: `apps/apple/HotCrossBuns/Services/SharedInbox/SharedInboxItem.swift:15-87`, `apps/apple/HotCrossBunsShareExtension/SharedInboxItem.swift:3-39`.
- The main app applies source, freshness, and size checks on consume: `apps/apple/HotCrossBuns/Services/SharedInbox/SharedInboxItem.swift:50-77`.

Exploit scenario:

Future edits update the extension writer but not the main-app trust checks, or vice versa. This can accidentally drop valid shares or loosen validation.

Impact:

Low current risk because the read side is hardened, but duplication is a maintainability hazard in a trust-boundary type.

Recommended fix:

Move the shared DTO and constants into a small shared source folder included by both targets, or add a test that validates both copies agree on app-group ID, key, schema, max size, and source prefix.

Verification:

- Add a test fixture encoded by one target copy and decoded/validated by the other.

### Hardening Observations

- The secret scan found no committed live Google API keys, OAuth client secrets, refresh tokens, private keys, or access tokens. Matches were expected source/test strings.
- The app sandbox is enabled for both app and extension. The main app still has broad capabilities: network client/server, user-selected read-write, app group, diagnostic reports exception, and mach lookup exception.
- The app correctly binds custom OAuth to `127.0.0.1`, uses PKCE and random `state`, and rejects state mismatch before token exchange: `apps/apple/HotCrossBuns/Services/Auth/CustomGoogleOAuthService.swift:191-221`.
- MCP binds to loopback and requires bearer auth before dispatching tools: `apps/apple/HotCrossBuns/Services/MCP/MCPServerController.swift:60-67`, `101-125`.
- Browser-origin checks reject non-local `Origin` values while allowing no-origin native clients: `apps/apple/HotCrossBuns/Services/MCP/MCPServerController.swift:254-258`.
- Deep links are intentionally non-mutating and cap parameter/id lengths: `apps/apple/HotCrossBuns/App/HCBDeepLinkRouter.swift:13-20`, `79-84`, `130-175`.
- App-group shared inbox consumption rejects missing/untrusted source, stale items, future-skewed items, and text over 8 KiB: `apps/apple/HotCrossBuns/Services/SharedInbox/SharedInboxItem.swift:21-77`.
- Google API transport redacts request paths and summarizes JSON rather than logging raw bodies unless raw diagnostics are enabled: `apps/apple/HotCrossBuns/Services/Google/GoogleDiagnostics.swift:22-39`, `111-125`, `191-221`.
- Console logging uses private metadata for OSLog while local file logs retain full metadata for diagnostics: `apps/apple/HotCrossBuns/Services/Logging/AppLogger.swift:161-196`.
- The CLI installer verifies `.sha256` before installing, which catches corruption and accidental mismatch: `docs/install-macos-preview.sh:90-107`.

## Dependency Posture

Pinned SwiftPM packages from `Package.resolved`:

| Package | Pinned | Latest checked | Notes |
| --- | ---: | ---: | --- |
| GoogleSignIn-iOS | 9.1.0 | 9.1.0 | Current latest release. |
| GTMAppAuth | 5.0.0 | 5.0.0 | Current latest release; release notes mention Mac keychain default changed to data protected. |
| AppAuth-iOS | 2.0.0 | 2.0.0 | Current latest release. |
| GoogleUtilities | 8.1.0 | 8.1.0 | Current latest release. |
| AppCheck | 11.2.0 | 11.2.0 | Current latest release. |
| GTMSessionFetcher | 3.5.0 | 5.3.0 | Behind current release line. Investigate compatibility through GoogleSignIn/GTMAppAuth constraints before updating. |
| Promises | 2.4.0 | latest release API reported 2.3.1 | Pinned tag is newer than latest release metadata; verify tag provenance during dependency maintenance. |

GitHub repository security-advisory API returned no public repository advisories for these seven dependencies during this audit. GitHub Advisory Database searches for `AppAuth-iOS`, `GoogleSignIn-iOS`, `GTMAppAuth`, and `GTMSessionFetcher` returned no matching reviewed advisories.

External sources checked:

- GoogleSignIn-iOS releases: https://github.com/google/GoogleSignIn-iOS/releases
- GTMAppAuth releases: https://github.com/google/GTMAppAuth/releases
- AppAuth-iOS releases: https://github.com/openid/AppAuth-iOS/releases
- GitHub Advisory Database searches: https://github.com/advisories

## Verification Performed

Static/read-only checks:

- High-risk source review across auth, MCP, persistence, logging/diagnostics, Google transport, ICS import, markdown HTML conversion, update/download, entitlements, installer/package scripts, and CI.
- Secret pattern scan for Google API keys, OAuth token strings, private keys, `client_secret`, `refresh_token`, and access tokens.
- Entitlement review for app and share extension.
- SwiftPM dependency inventory from `Package.resolved`.
- Current release/advisory checks against GitHub releases and GitHub security-advisory endpoints.

Focused test attempt:

```bash
xcodebuild -project apps/apple/HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS' \
  -derivedDataPath build/apple/SecurityAuditDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  test \
  -only-testing:HotCrossBunsMacTests/MCPServerControllerTests \
  -only-testing:HotCrossBunsMacTests/HCBToolServiceTests \
  -only-testing:HotCrossBunsMacTests/HCBCacheCryptoTests \
  -only-testing:HotCrossBunsMacTests/DiagnosticBundleTests \
  -only-testing:HotCrossBunsMacTests/ReleaseConfigGateTests \
  -only-testing:HotCrossBunsMacTests/GoogleAuthServiceHelpersTests \
  -only-testing:HotCrossBunsMacTests/LocalCacheStoreSplitTests \
  -only-testing:HotCrossBunsMacTests/ICSImporterTests
```

Result: failed during build before tests ran. `xcodebuild` reported `Cannot find type 'HCBTransitionMeasurement' in scope`. `rg` shows `HCBTransitionProfiler.swift` defines the type, but `git ls-files` does not list that file, and the generated Xcode project used by the command does not currently compile with the existing uncommitted references.

## Hardening Backlog

Immediate:

- Fix MCP confirmation issuance so confirmation IDs are created only by explicit dry-runs.
- Add MCP aggregate request/header/body limits and `413` handling before auth/JSON parsing.
- Encrypt backups when cache encryption is enabled, and add a migration path for existing plaintext backups.
- Repair the current compile/test blocker so the security-surface test suites can run again.

Next release:

- Add checksum verification to in-app updater downloads.
- Move custom OAuth Keychain entries to `ThisDeviceOnly` accessibility and migrate old entries.
- Escape OAuth loopback callback text and render generic failure pages for untrusted callback parameters.
- Improve diagnostic bundle redaction or require explicit raw-payload inclusion at export time.
- Add markdown-to-HTML escaping and URL scheme allowlisting.

Optional future work:

- Sign and notarize release DMGs, then verify expected Team ID before presenting updates as ready.
- Publish detached release signatures or signed checksums from a separate trust root.
- Parse system crash report metadata to verify bundle ID before displaying contents.
- Remove shared-inbox DTO duplication by compiling one shared source into both targets.
- Add a scheduled dependency audit job or Dependabot/Renovate rule for SwiftPM packages and GitHub Actions.

## Residual Risk

The app's serverless design avoids backend compromise and analytics exfiltration risks, but it concentrates trust on the local Mac, Keychain, Google OAuth project, and GitHub release channel. For the current personal-use distribution model, the highest-value hardening work is to make "local-only" artifacts consistently encrypted when users opt into encryption, and to make MCP confirmation and update-download integrity match the app's own trust messaging.
