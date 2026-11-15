# Hot Cross Buns follow-ups

Keep the product focused on a plain-text journal with lightweight task tracking. The [README](./README.md) describes the current app; [TODO_FORMAT.md](./docs/TODO_FORMAT.md) defines its portable data.

## Delivered foundation

- [x] Dated items, undated lists, details, completion and scratchpad capture.
- [x] Hashtags, text search and tag filters.
- [x] Time blocks, multi-day spans and scheduled or after-completion recurrence.
- [x] Drag to reorder or move items; keyboard sibling creation and detail promotion/demotion.
- [x] Responsive browser layouts, themes, appearance preferences and shared browser popouts.
- [x] Explicit TODO.txt import, doctor, conflict review and download preview.
- [x] Separate, read-only Google Calendar and Tasks snapshot tools.
- [x] Failed-save draft recovery and bounded imports and recurrence projections.
- [x] Quick Today/Tomorrow moves using the journal's time zone, normal recurrence choices and undo.
- [x] All/Open/Done search filters combined with text and hashtags across dated entries.
- [x] Neutral dark mode and borderless text fields.
- [x] Smooth caret movement while typing and navigating, with an idle pulse and reduced-motion support.
- [x] Command palette for the five existing topbar actions (⌘K / Ctrl+K), using the compact browser palette and scale/fade motion from commit `8f2c2b2`.

Caret movement covers ordinary text inputs and textareas. Selections, IME composition, touch selection handles, passwords, segmented controls, bidirectional text and editors above 32,768 UTF-16 code units use the native caret. Reduced motion, forced colors and browsers without the Popover API also keep the native caret.

## Next validation

- [ ] Dogfood capture, complete, defer, find and export for two weeks. Record where text loses context or the workflow needs extra steps.
- [ ] Check persistence, import/download and failed-save recovery on actual Safari, Firefox and mobile browsers. Chromium automation and phone viewport tests do not establish compatibility with those browsers or devices.
- [ ] Review keyboard and screen-reader navigation across journal rows, details, dialogs and popouts.
- [ ] Measure real journal sizes and the new resource-limit notices before changing limits or adding a file-size indicator.
- [ ] Validate quick deferral, status search and the command palette during dogfooding. Use observed problems to decide whether fuzzy matching or natural-language entry earns the added complexity. These are candidates, not committed features.

## Retired directions

- A full calendar application or parity with the Google Calendar and Tasks suites.
- Automatic deletion of old journal content.
- A hosted database, Google Drive sync or continuous Google account sync.
- Electron, a desktop menubar app or an installable PWA as part of this browser restoration.

Keep the one-time Shio Pan storage migration, old Google snapshot format alias and old service-worker retirement code while existing users may still need them. Removing those compatibility paths requires a separate migration decision.
