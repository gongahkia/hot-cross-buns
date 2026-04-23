# macOS Design Audit

Audit scope: `apps/apple/HotCrossBuns/Features/`, `apps/apple/HotCrossBuns/Design/`, and `apps/apple/HotCrossBuns/App/`.

Baseline note: signed `make build` is blocked in this local environment by missing `Q2J4QWZLR7` provisioning profiles. The documented unsigned compile check succeeds:

```sh
cd apps/apple
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' -derivedDataPath ../../build/apple/DerivedData build CODE_SIGNING_ALLOWED=NO
```

## Summary

| Category | Count |
| --- | ---: |
| Critical | 2 |
| High | 4 |
| Medium | 5 |
| Low | 3 |

## Critical

### C1. Root window chrome is painted with app palette color

- Files: `apps/apple/HotCrossBuns/Design/DesignTokens.swift:22-30`, `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:64-75`, `apps/apple/HotCrossBuns/Features/Store/StoreView.swift:43-72`, `apps/apple/HotCrossBuns/Features/Calendar/CalendarHomeView.swift:18-75`
- Deviation: `.appBackground()` globally hides scroll backgrounds and paints root panes with `AppColor.cream`. That makes the main split view, sidebar-adjacent surfaces, inspector backgrounds, and detached windows feel branded rather than system-native.
- Native convention: primary windows and split views should preserve system window/sidebar materials, desktop tinting, and semantic backgrounds. Custom palette colors are appropriate for content accents and user-customized surfaces, not structural chrome.
- Proposed fix: change `AppBackground` to use a system window background and stop hiding scroll content backgrounds globally. Keep the HCB color scheme tokens available for content cards, badges, task dots, calendar colors, and user-selected content surfaces.

### C2. Native sidebar toggle is removed and system collapse is blocked

- Files: `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:165-170`, `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:311-326`
- Deviation: the sidebar removes `.sidebarToggle` from the toolbar and snaps `NavigationSplitViewVisibility.detailOnly` back to `.all`. This makes the window behave unlike Finder, Mail, Notes, Calendar, and System Settings.
- Native convention: `NavigationSplitView` should expose the standard sidebar toggle and allow the user to hide/reveal the sidebar with the system toolbar affordance.
- Proposed fix: remove `.toolbar(removing: .sidebarToggle)` and the visibility snapback handler. Preserve selection, commands, and `SceneStorage`.

## High

### H1. Sidebar metrics override source-list sizing conventions

- Files: `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:26-34`, `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:291-326`, `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:765-783`
- Deviation: the sidebar has a fixed 172pt width and custom 18pt icons in 24pt frames. This bypasses macOS sidebar size preferences and makes the source list feel hand-sized.
- Native convention: source-list rows should let `Label` and `.listStyle(.sidebar)` choose glyph and row metrics, and the split view should offer a reasonable min/ideal/max width.
- Proposed fix: use a flexible `navigationSplitViewColumnWidth(min:ideal:max:)`, remove custom icon font/frame sizing, and let `Label` render the sidebar symbol.

### H2. Settings window fights native Form scrolling and row rhythm

- Files: `apps/apple/HotCrossBuns/Features/Settings/HCBSettingsWindow.swift:40-89`, `apps/apple/HotCrossBuns/Features/Settings/HCBSettingsWindow.swift:136-207`, `apps/apple/HotCrossBuns/Features/Settings/HCBSettingsWindow.swift:226-239`, `apps/apple/HotCrossBuns/Features/Settings/HCBSettingsWindow.swift:248-279`
- Deviation: each Settings tab wraps `Form` content in an outer `ScrollView`, then disables the inner form scroll with `.scrollDisabled(true)`. This creates non-standard Settings chrome and can break keyboard scrolling/focus behavior.
- Native convention: Settings panes should use `Form` directly with `.formStyle(.grouped)` or `.formStyle(.columns)`, allowing the form to own row layout and scrolling.
- Proposed fix: remove the outer `ScrollView` wrappers and `.scrollDisabled(true)`, and apply content padding/width constraints around direct `Form` views.

### H3. Quick-create popover uses custom card chrome and brand tint for structural controls

- Files: `apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift:130-170`, `apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift:316-370`, `apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift:397-497`, `apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift:563-648`, `apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift:715-733`
- Deviation: the popover manually draws multiple rounded cream panels and tints switch/prominent controls with `AppColor.ember`. This makes a core create surface look more branded/iOS-like than Calendar/Reminders-style macOS popovers.
- Native convention: popovers should be compact transient editors, use semantic fills/materials, and let accent color drive primary/default controls.
- Proposed fix: replace structural `AppColor.cream` fills with semantic quaternary/material fills and use `.tint(.accentColor)` for structural toggles and the primary button.

### H4. Notes cards hardcode a light background

- Files: `apps/apple/HotCrossBuns/Features/Store/StoreView.swift:1001-1049`
- Deviation: `NoteCard` uses `Color.white.opacity(0.92)`, which does not adapt cleanly in Dark Mode or high-contrast appearances.
- Native convention: content cards should use adaptive material or system control backgrounds.
- Proposed fix: replace the hardcoded white fill with `.regularMaterial` or a semantic control background and keep the existing stroke/selection behavior.

## Medium

### M1. Several transient overlays use iOS-like spring animation

- Files: `apps/apple/HotCrossBuns/App/MacSidebarShell.swift:119-129`, `apps/apple/HotCrossBuns/Design/UndoToast.swift:18-21`, `apps/apple/HotCrossBuns/Design/BulkResultToast.swift:24-27`, `apps/apple/HotCrossBuns/Design/DeepLinkErrorToast.swift:23-26`
- Deviation: toast/HUD transitions use spring animation. The result reads more iOS-like than macOS system feedback.
- Native convention: macOS productivity chrome uses short, restrained ease animations.
- Proposed fix: replace springs with `.easeOut` or `.easeInOut` animations around 0.12-0.18s.

### M2. Small modal sheets omit default/cancel keyboard routing

- Files: `apps/apple/HotCrossBuns/Features/Store/StoreView.swift:476-638`, `apps/apple/HotCrossBuns/Features/Settings/EncryptionSection.swift:101-152`, `apps/apple/HotCrossBuns/Features/Settings/CustomFiltersSection.swift:89-219`
- Deviation: several sheet confirmation and cancellation buttons lack `.keyboardShortcut(.defaultAction)` and `.keyboardShortcut(.cancelAction)`.
- Native convention: Return activates the default action and Esc cancels/dismisses modal work.
- Proposed fix: apply standard keyboard shortcuts to Cancel/Move/Snooze/Save/Apply buttons and use `.buttonStyle(.borderedProminent)` only on the primary action.

### M3. Settings rows rely on swipe actions without contextual menu parity

- Files: `apps/apple/HotCrossBuns/Features/Settings/CustomFiltersSection.swift:23-48`, `apps/apple/HotCrossBuns/Features/Settings/TemplatesSection.swift:32-104`
- Deviation: delete/edit actions are surfaced through `.swipeActions`, which is less discoverable on macOS and lacks right-click parity.
- Native convention: interactive rows should expose common row actions through context menus, while destructive actions sit last.
- Proposed fix: add `.contextMenu` actions for edit/duplicate/delete equivalents while preserving existing swipe actions for trackpad users.

### M4. Sidebar help text documents a non-native collapse shortcut

- Files: `apps/apple/HotCrossBuns/Features/Help/HelpView.swift:32-41`
- Deviation: Help says `⌘S` collapses the sidebar, but the app currently blocks native sidebar hiding and does not define a sidebar-collapse command in the audited shortcut registry.
- Native convention: sidebar visibility should be controlled by the system toolbar/menu affordance; help should document actual platform commands.
- Proposed fix: update Help copy after C2 so it does not advertise a custom sidebar behavior.

### M5. Hidden keyboard-shortcut buttons are embedded as zero-size backgrounds

- Files: `apps/apple/HotCrossBuns/Features/Store/StoreView.swift:47-66`, `apps/apple/HotCrossBuns/Features/Calendar/CalendarHomeView.swift:197-218`, `apps/apple/HotCrossBuns/Features/Tasks/TaskInspectorView.swift:131-141`
- Deviation: invisible zero-size `Button` views are used to host keyboard shortcuts. This works, but it is harder for VoiceOver/focus inspection and menu parity than scene commands/focused values.
- Native convention: keyboard shortcuts should generally be exposed through menu commands, focused values, or visible buttons.
- Proposed fix: move these actions into `AppCommands` or focused command values.
- Status: addressed by routing Store, Calendar, and Task Inspector shortcuts through focused command values in the app command menus.

## Low

### L1. Help window uses oversized marketing-like typography

- Files: `apps/apple/HotCrossBuns/Features/Help/HelpView.swift:89-98`
- Deviation: the Help window uses `.largeTitle.bold` and a product tagline. It is acceptable but reads more like onboarding than a compact macOS help/reference window.
- Native convention: help/reference windows generally use restrained headings and denser rows.
- Proposed fix: reduce the header to `.title3.weight(.semibold)` or a grouped form/list style.

### L2. Card corner radii are larger than typical macOS content cards

- Files: `apps/apple/HotCrossBuns/Design/DesignTokens.swift:33-54`
- Deviation: `CardSurface` defaults to 28pt radius, much rounder than most macOS utility/content cards.
- Native convention: macOS productivity surfaces usually use smaller radii unless the design deliberately calls for a custom card identity.
- Proposed fix: lower the default radius if future card work touches these surfaces.

### L3. Some text uses rounded font design in utility search rows

- Files: `apps/apple/HotCrossBuns/App/CommandPaletteView.swift:503-595`
- Deviation: command/entity rows use rounded fonts. This is a stylistic choice, but it differs from standard Spotlight/Shortcuts list typography.
- Native convention: system font defaults are more common for command surfaces.
- Proposed fix: consider returning these rows to the default system design in a future command palette pass.

## Deferred

### D1. Command palette presentation is a custom Alfred-style sheet

- Related finding: `apps/apple/HotCrossBuns/App/CommandPaletteView.swift:142-203`
- Reason: making this fully native would likely require a dedicated utility panel/window or a focused command/search scene rather than a `.sheet` with custom material and clear presentation background. That is a larger scene-architecture change and risks behavior outside a pure chrome pass.
