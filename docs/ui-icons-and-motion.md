# Icons and motion — 2026-10-29

Implemented in `8f2c2b2`. This follows the completed sync work; it changes presentation and sync progress feedback, not the sync engine or storage model. `README.md` is unchanged.

## Choice and research

Use Font Awesome Free **7.3.1** (Regular and Solid) with the official React component **3.5.0**. Individual SVG definitions and CSS ship with the app; no kit, CDN, webfont, account, or paid icon package is needed. The renderer's 48 Lucide import sites were migrated or removed, and the native menu bar's hand-written Lucide-style glyphs now use the same Font Awesome definitions. The application logo and operating-system tray assets are outside this icon-pack change.

Font Awesome's [React animation utilities](https://docs.fontawesome.com/web/use-with/react/style#animate-icons) support loading rotation and other effects. Its [animation guidance](https://docs.fontawesome.com/web/style/animate) supports reduced motion and recommends accompanying motion with static feedback. Use the existing Motion library for state transitions and Font Awesome's continuous spin only while work is actually running. [Individual icon imports](https://docs.fontawesome.com/web/use-with/react/add-icons#add-individual-icons) avoid registering an entire style library.

Regular glyphs are preferred where Free includes them; compact actions use Solid when that is the available appropriate glyph. All inherit `currentColor` and occupy an explicit square. We do not try to turn filled paths into thin strokes. Starred items use the Solid star, plus accent color and `aria-pressed`.

Font Awesome Free icons are by Fonticons, Inc., licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its code uses MIT. See the [Free license](https://fontawesome.com/license/free) and installed package license files. The production JS retains Font Awesome's license comments.

## Full interface review

Scope: React 19 renderer and generated native menu bar HTML; existing Tailwind utilities, CSS tokens and Motion. Review covers navigation, calendar, task and note actions, rich text controls, onboarding, settings, status/error/empty states and shared controls. It is not a redesign of every screen or a native-window integration test.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | `styles/index.css`, `primitives.tsx`, `SettingsPrimitives.tsx`; light/dark screenshots | Existing font smoothing and hierarchy retained; redundant label decoration removed |
| Surfaces | Onboarding cards, calendar form/empty agenda, task rows, settings, native panel | Icon removal preserves spacing; shared square glyph bounds avoid row movement |
| Animations | `AnimatedIcon.tsx`, `AppHeader.tsx`, select/disclosure CSS, starred task/note actions, Google access dialog | State swaps, progress rotation and live reduced-motion changes verified |
| Icons | Shared icon registry, all migrated consumers below, native HTML | Font Awesome throughout this pack; decorative SVGs hidden from assistive technology, named controls retained |
| Performance | Individual imports, pure component factories, production bundle sizes | No extra animation runtime; bundle cost measured below, no runtime speed claim |

### Findings addressed

Locations below the renderer root mean `src/renderer/src/`.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `components/icons.tsx:95`; all import sites in the inventory | Direct Lucide imports and Lucide-specific types/stroke props | Shared Font Awesome SVG components, generic `AppIcon` type, regular/solid choices, consistent size/color/ref behavior; Lucide dependency removed | One icon family and consistent optical sizing |
| LOW | `components/FirstRunOnboarding.tsx:502`, `components/states.tsx:68`, `features/core/screens/calendar/CalendarEventForm.tsx:438`, `features/core/screens/settings/DataSettingsTab.tsx:1` | Decorative icon boxes and symbols repeating nearby text | Text-led setup and empty states; simple event field labels and data action buttons | Remove visual clutter; keep icons for controls, status and meaningful content |
| LOW | `features/core/screens/settings/SettingsPrimitives.tsx:166`, General/Profile/Hotkeys settings call sites | Ignored icon props remained after settings became text-led | Remove unused props/imports; keep navigation and segmented controls text-only | Remove misleading component API and preserve a quiet settings surface |
| MEDIUM | `components/AnimatedIcon.tsx:16`, `components/primitives.tsx:26`, `features/shell/AppHeader.tsx:23`, task/notes boards, Profile settings | Abrupt visibility/save/star glyph changes; outline-only star after a naive pack swap | Brief opacity/scale/blur transitions with no bounce; outline/filled stars; stable 16px bounds; no entrance animation on initial render | Clear state changes without layout shifts or repeated navigation motion |
| MEDIUM | `components/AnimatedIcon.tsx:6`, `styles/index.css:494` | The installed Motion hook snapshots the OS preference at mount | Live media-query subscription; both OS reduced motion and the app setting cancel icon motion, retaining the static glyph | Motion restraint and accessible feedback when preferences change during use |
| MEDIUM | `features/shell/AppHeader.tsx:60`, `features/shell/AppShell.tsx:925` | Reload icon remained static during Google work | Smooth rotation only while actual sync status is `syncing`; busy/disabled state and status text; stops on completion | Loading motion reflects real work and has a non-motion equivalent |
| LOW | `styles/index.css:497` | Select and inspector-type chevrons stayed pointed down while open | Interruptible 160ms rotation tied to the existing open state | Disclosure state remains clear; reduced-motion rules still apply |
| LOW | `src/main/native/electronMac/menuBarPanelHtml.ts:16`, `menuBarPanelStyles.ts:25` | Separate line icon paths and decorative symbols in the brand/empty rows | Bundled Font Awesome SVG paths for actions/items; text-only brand and empty rows | Consistency with the renderer while keeping the native HTML script-free |

### Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Shared icon system | [Lucide Motion](https://lucide-motion.aashuu.me/docs) | Offers animated Lucide components, but retains the family the user asked to replace |
| Shared icon system | [Lordicon](https://lordicon.com/docs) | Separate animated asset catalog and integration; Font Awesome plus the already-installed Motion library covers these state changes with one visual family |
| Navigation and toolbar | Loop, bounce or draw every icon on hover | Routine navigation would repeatedly attract attention; animation is reserved for state and work feedback |
| Package setup | Register entire Regular/Solid styles globally | Individual definitions are sufficient and make the shipped subset explicit |

## Verification

- `corepack pnpm test:unit src/renderer src/main/native/electronMac/menuBarPanelHtml.test.ts`: **162 tests / 46 files passed** during the migration and again after the UI changes. The subsequent live preference subscription is covered by the browser checks below.
- `corepack pnpm test:ui tests/smoke/icons.spec.ts tests/smoke/workspace-ui.spec.ts tests/smoke/markdown-editor.spec.ts tests/smoke/app.spec.ts`: **26/26 passed**. Includes three new icon cases, every settings category, calendar menus, keyboard/search, task/note/event editing, conversions, rich Markdown, and persisted state.
- New browser checks verify fixed visibility-icon bounds, filled starred state, text-only navigation, select rotation, both motion preferences changed at runtime, and a real worker sync held at the mocked HTTP boundary. The Reload icon rotates only during that held request and stops after completion.
- `corepack pnpm build`: both TypeScript checks and the production build passed. Existing chunk-size and deprecation warnings remain.
- `corepack pnpm test:production`: account gate, durable recovery and absence of test hooks passed.
- `corepack pnpm test:offline`: all four production offline/update scenarios passed; icons are bundled for offline use.
- Screenshots inspected at 1180×760 and 640×480: calendar light/dark, starred tasks, dark settings, event editor, required Google setup, reduced motion. Native HTML preview inspected at 360×650 in light/dark. Artifacts are in ignored `output/ui-review/icons-*.png`.
- Hover, focus, selected, disabled/busy and empty states were exercised. The actual sync rotation was slowed to 10% playback for review; visibility swaps were also checked for reversal and correct final glyph.

The production JS asset total increased by **118,124 bytes** and CSS by **26,843 bytes**, compared with the pre-change `dist` build. Vite reports the entry chunk at 369.87 kB gzip versus 332.55 kB before. This is a measured bundle-size tradeoff for the requested Font Awesome family and official renderer/CSS, not a performance improvement claim. Whole-package icon registration, Lottie and another animation library were avoided.

**Verdict: Approve for the reviewed scope.** Not verified: frame-by-frame 10% playback of the JavaScript-driven swaps (normal-speed state and reversal checks passed), a live macOS native popover launch (generated HTML preview and native unit checks passed), Safari/Firefox, and production-device latency. Sync correctness tests from the preceding work were not rerun for this presentation change. Google responses in the progress check are mocked.

## Migration inventory

The files below cover shared controls, legacy renderer surfaces and data definitions as well as current screens. Icon imports and types were changed here; the findings table identifies the behavioral/visual changes. Paths are relative to `src/renderer/src`.

- `components/AnimatedIcon.tsx:1`
- `components/CommandPalette.tsx:1`
- `components/DateTimeField.tsx:1`
- `components/FirstRunOnboarding.tsx:1`
- `components/Inspector/InspectorItemToolbar.tsx:1`
- `components/Inspector/InspectorSearch.tsx:1`
- `components/Inspector/InspectorShell.tsx:1`
- `components/QuickAddDialog.tsx:1`
- `components/ReferenceTextarea.tsx:1`
- `components/Select.tsx:1`
- `components/icons.tsx:1`
- `components/markdown/RichMarkdownEditor.tsx:1`
- `components/primitives.tsx:1`
- `components/states.tsx:1`
- `components/ui/checkbox.tsx:1`
- `data/mockPlanner.ts:1`
- `features/core/DiagnosticsOverlay.tsx:1`
- `features/core/DiagnosticsTabs.tsx:1`
- `features/core/DuplicateReviewPanel.tsx:1`
- `features/core/MarkdownPreview.tsx:1`
- `features/core/coreScreenShared.tsx:1`
- `features/core/inspectors/NoteInspectorBody.tsx:1`
- `features/core/inspectors/TaskInspectorBody.tsx:1`
- `features/core/screens/LegacyNotesMigrationDialog.tsx:1`
- `features/core/screens/NotesBoard.tsx:1`
- `features/core/screens/NotesSidebar.tsx:1`
- `features/core/screens/calendar/CalendarEventChips.tsx:1`
- `features/core/screens/calendar/CalendarEventForm.tsx:1`
- `features/core/screens/calendar/CalendarEventMenu.tsx:1`
- `features/core/screens/calendar/CalendarHeader.tsx:1`
- `features/core/screens/calendar/CalendarOverflowPopover.tsx:1`
- `features/core/screens/calendar/CalendarSidebar.tsx:1`
- `features/core/screens/calendar/CalendarSyncStatus.tsx:1`
- `features/core/screens/calendar/CalendarTimelineView.tsx:1`
- `features/core/screens/calendar/CalendarView.tsx:1`
- `features/core/screens/settings/AboutSettingsTab.tsx:1`
- `features/core/screens/settings/AlertsSettingsTab.tsx:1`
- `features/core/screens/settings/AppearanceSettingsTab.tsx:1`
- `features/core/screens/settings/DataSettingsTab.tsx:1`
- `features/core/screens/settings/GeneralSettingsTab.tsx:1`
- `features/core/screens/settings/HotkeysSettingsTab.tsx:1`
- `features/core/screens/settings/ProfileSettingsTab.tsx:1`
- `features/core/screens/settings/SettingsPrimitives.tsx:1`
- `features/core/screens/settings/SettingsView.tsx:1`
- `features/core/screens/tasks/GoogleTasksBoard.tsx:1`
- `features/core/screens/tasks/TaskPanels.tsx:1`
- `features/core/screens/tasks/TaskScheduleDialog.tsx:1`
- `features/shell/AppHeader.tsx:1`
- `features/shell/AppOverlays.tsx:1`
- `features/shell/AppShell.tsx:1`
- `features/shell/MiniCalendar.tsx:1`
