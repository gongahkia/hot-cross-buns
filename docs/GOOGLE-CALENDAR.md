# Google Calendar

Google Calendar is available as an optional part of an existing Google connection. Calendar permissions are separate from default email sign-in, and local plan dates remain separate from real Calendar events. No existing account was connected or modified during implementation.

## Setup

1. Open **Connections** and connect or select the intended Google account. This build may offer a distribution sign-in client or require a user-owned Google Desktop OAuth client. For your own client, enable the Calendar API in that Cloud project as well as the APIs already used by the connection.
2. Choose **Enable calendar reading**, review the requested access and finish Google browser consent. Failed, cancelled or incomplete consent keeps the previous local connection.
3. Choose **Enable calendar changes** only if event creation, updates or deletion are needed. This requests event access alongside reading and existing account permissions. It does not approve any particular event change.
4. Use **Check account & read access**. When Calendar is enabled this includes a bounded Calendar event request, so successful email access alone is not reported as Calendar readiness.
5. Select the account as a source for the intended chat or task. Selecting an account does not itself perform a read or change. User-controlled account access remains subject to connector permissions and task scope.

**Turn off calendar changes** retains reading for new tasks. **Turn off calendar access** removes Calendar operations while preserving other services. These local changes do not revoke Google's remote authorization or cancel requests already sent. Use Google's account settings for service-side revocation.

## Supported operations

| Operation | Behavior |
| --- | --- |
| `calendar_list` | List subscribed calendars, with bounded page size and pagination. |
| `calendar_events` | Read a selected calendar over an explicit range of up to 90 days; recurring instances are expanded. |
| `calendar_event_get` | Read one exact event, including its ETag. |
| `calendar_freebusy` | Request availability for 1–20 exact calendar IDs over a range of up to 90 days. Per-calendar errors remain visible. |
| `calendar_event_create` | Create a single event after exact approval and validate the returned event ID. |
| `calendar_event_update` | Patch an exact event after approval, with its previously read ETag in `If-Match`. |
| `calendar_event_delete` | Delete an exact event after approval and ETag validation; success requires HTTP 204. |

Calendar/event IDs are separate fields and cannot redirect requests away from the configured service. Timed events require RFC3339 timestamps with explicit offsets. Optional named zones must be valid IANA zones. All-day end dates are exclusive. Rescheduling requires both start and end, and end must follow start. Updates leave unspecified fields unchanged; an attendee list replaces the previous list, including removal via an explicit empty array.

Each event write must include `send_updates: "all"` or `"none"`; this request is included in the exact review with the calendar, event and proposed changes. Notification behavior remains Google's responsibility. Missing/stale ETags and invalid ranges are rejected. A 412 response is reported as a rejected stale write, requiring a new read and new review. Ambiguous creates or other uncertain outcomes must not be retried automatically.

The existing action broker, task scopes, credential pins, durable journal and connector permission rules are reused. Calendar writes are excluded from unattended read-only tool surfaces and from the Docs/Sheets batch mutation helper.

## Deliberate limits

Calendar sharing/ACL administration, calendar creation/deletion, recurring-series creation and Google Tasks are not added. An exact instance event ID can be used to change one occurrence; deleting a series event ID affects that series and must be reviewed accordingly.

Older Calendar watches without an explicit calendar ID are not silently reactivated. Select and review the calendar before enabling change detection.

Live Google consent and event changes were not verified against a real account. Controlled HTTP/OAuth tests cover requests, scope publication, failed consent, exact write approval, stale revisions and receipts. See [verification](verification/local-browser-calendar-2026-11-24.md).

The implementation follows Google's [scope guide](https://developers.google.com/workspace/calendar/api/auth), [event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [free/busy query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [patch semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [deletion](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete), and [conditional modification](https://developers.google.com/workspace/calendar/api/guides/version-resources) documentation.

## Change detection

Follow-through can watch an explicitly reviewed calendar for the next 1–30 local
days. The bounded reader expands recurring instances and follows at most five
pages (500 events); incomplete coverage produces an error, never a quiet result.
The window stays fixed within a local day. Event fingerprints participate in
the existing change and notification gates. Old watches without a calendar ID
remain inactive until the user selects and reviews a calendar.
