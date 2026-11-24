# Local-model browser and Calendar verification — 24 November 2026

Managed local models can use explicitly granted browser text tools. Text-only models are not offered screenshots. The web Settings screen opens the existing browser-session controls. Google Calendar now has optional account consent, bounded reads/availability and exact-reviewed event changes. Existing task scope, credential pinning and action-journal mechanisms remain in use.

## Observed checks

| Check | Result |
| --- | --- |
| Full `make check`, Node 26.7.0, canonical macOS `TMPDIR` | Passed: runtime build, all Go packages, vet, 120 browser tests, 142 host tests and one OAuth build test |
| Local-provider route | Passed: selected local model retains the explicit browser grant and caller opt-out; no visual capability upgrade |
| Text-only agent browser workflow | Passed: snapshot reaches the model; mutation requires fresh review and a denial reaches no browser action |
| Calendar HTTP and tool contracts | Passed: exact paths/methods, bounded ranges, pagination/errors, notification choice, no dispatch during preparation, exact foreground approval and receipt identity |
| Calendar concurrency protection | Passed: ETag carried as `If-Match`; missing/wildcard ETag rejected; HTTP 412 reported as a rejected write |
| Calendar consent and account controls | Passed: read/write scope separation, no publication before consent, failed/partial consent retains prior local account, local narrowing preserves other services |
| Calendar account/read checks | Passed: explicit Calendar event probe in addition to granted email/Drive checks |
| Focused race tests | Passed for Calendar connector/account paths and the local-model browser route |
| Exported committed snapshot `bee2b8a1c` | Focused Go suites, its own runtime build and web browser-route test passed without earlier uncommitted features |
| Actual Chromium controller integration | Passed with the pinned browser installed, under Node 26.7.0: selected tabs, origins, reference invalidation, private takeover and stop behavior were exercised against synthetic local pages |
| Impeccable source scan | No findings on the reused Settings view; source-only coverage, without rendered layout/contrast acceptance |

The full working-tree check also includes earlier requested uncommitted features. Those edits were kept separate from these commits. The committed snapshot reused installed Node dependencies, built its own runtime, and contained no copied credentials.

Reproduce the standard check:

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
```

## Failures retained during verification

The first opt-in Chromium run timed out at 480 seconds during runtime installation, before browser actions. Its owned installer processes were stopped. A bounded Node 26 download diagnostic also reached its 35-second limit. Installing the same pinned Playwright/Chromium runtime under Node 20.19.5 completed; reusing that runtime for the Chromium integration test under Node 26.7.0 passed in 3.26 seconds. The same pinned runtime was then installed for the normal local app through its existing internal developer command using Node 20.19.5; `browser status` confirmed it installed. No app browser session, tab grant or connected account was created. No TLS validation, origin policy or runtime version pin was weakened. The observations do not establish the cause of the download stalls or acceptance of every Node/browser installation combination.

The initial focused Calendar run caught tests that asserted the prior removal of Calendar. Those tests now assert the intended narrower boundaries: default email sign-in does not gain Calendar access, Calendar reads require exact targets/ranges, and legacy Calendar-specific change-only watches remain blocked. A Connections-label expectation was updated when its entry became “Connect Google.” No approval or access checks were removed to satisfy tests.

Local logs retained during this session include `/tmp/hcb-laptop-calendar-final-check.log`, `/tmp/hcb-calendar-final-focused.log`, `/tmp/hcb-laptop-calendar-race.log`, `/tmp/hcb-local-browser-chromium.log`, `/tmp/hcb-chromium-download-diagnostic.log`, `/tmp/hcb-chromium-node20-diagnostic.log` and `/tmp/hcb-local-browser-chromium-retry.log`. The [machine-readable summary](local-browser-calendar-2026-11-24.json) records the verification scope.

## Unverified and remaining scope

No local Ollama server was running, so actual installed-model tool-call quality and outcome-level personal-assistant usefulness are unverified. The local-provider and text-agent tests use contained loopback/scripted fixtures; actual Chromium acceptance is separate evidence and does not turn those into a live-model benchmark. No cloud model was substituted and no model weights were downloaded.

No Google account was connected or changed. Real Google consent, API enablement, invitation/notification delivery and live event mutations are unverified. HTTP/OAuth fixtures exercise the full host-owned consent and review paths, without using real credentials or calendar data.

Arbitrary OS/app control remains on its existing supported desktop/CUA route. Calendar-specific change-only watches remain unsupported rather than reviving retired jobs. Calendar ACL administration, calendar creation/deletion, recurring-series creation and Google Tasks are not added.

For usage and current limits, see [local-model laptop workflows](../LOCAL-MODEL-LAPTOP-WORKFLOWS.md) and [Google Calendar](../GOOGLE-CALENDAR.md).
