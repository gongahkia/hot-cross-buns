# macOS Design Reference

This reference captures the platform conventions used for the Hot Cross Buns macOS-native design audit. It is based on Apple Human Interface Guidelines, SwiftUI macOS documentation, and a visual pass over the conventions used by Apple Calendar, Reminders, Mail, Notes, Messages, Finder, Console, Shortcuts, System Settings, and Settings-style panes.

## Primary Sources

- Apple HIG: [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- Apple HIG: [Windows](https://developer.apple.com/design/human-interface-guidelines/windows)
- Apple HIG: [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- Apple HIG: [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- Apple HIG: [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- Apple HIG: [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles/)
- Apple HIG: [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
- Apple HIG: [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)
- Apple HIG: [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)
- Apple HIG: [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- Apple HIG: [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- Apple HIG: [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- Apple HIG: [Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus)
- Apple HIG: [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)
- Apple HIG: [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards/)
- Apple HIG: [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
- SwiftUI: [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- SwiftUI: [Form](https://developer.apple.com/documentation/swiftui/form)
- SwiftUI: [FormStyle](https://developer.apple.com/documentation/swiftui/formstyle)
- SwiftUI: [KeyboardShortcut](https://developer.apple.com/documentation/SwiftUI/KeyboardShortcut)
- SwiftUI: [Controls and indicators](https://developer.apple.com/documentation/swiftui/controls-and-indicators)
- SwiftUI: [Windows](https://developer.apple.com/documentation/swiftui/windows)

## Window Chrome

- A primary macOS window should keep the standard frame, titlebar controls, and resize behavior unless the app has a strong, content-specific reason to customize chrome.
- Main actions belong in the window toolbar, grouped by task. Toolbar items should also exist as menu commands because users can hide or customize toolbars.
- In SwiftUI, prefer scene/window APIs first: `WindowGroup`, `Window`, `.commands`, `.toolbar`, `.windowStyle`, and `.windowToolbarStyle`. Use AppKit only for gaps SwiftUI does not model cleanly.
- Finder, Mail, Notes, Calendar, Console, and Shortcuts all use native titlebar-integrated toolbar chrome. They do not paint custom top bars inside the content area to simulate window chrome.
- Search commonly lives on the trailing side of the toolbar for global app search. Sidebar-scoped filtering can live at the top of the sidebar.

## Sidebar And Split Navigation

- `NavigationSplitView` with a leading `.listStyle(.sidebar)` source list is the expected shape for apps with multiple top-level areas or collections.
- Source-list rows are visually flat. They use standard selection highlights, one optional symbol, one primary label, and at most one compact secondary label.
- Sidebar icon size and row metrics should respect the user’s macOS sidebar size preference. Avoid hardcoded large cards, chips, or branded sidebars that override source-list rhythm.
- Sidebar symbols generally follow the user’s accent color. Fixed colors are appropriate only when the color itself communicates meaning.
- Avoid placing essential actions only at the bottom of a sidebar, because that area may be hidden by small windows or Dock placement.
- When a hierarchy is deeper than two levels, use a content list or detail column rather than stuffing all hierarchy into a single custom sidebar.

## Controls

- Use the platform default control size unless the surrounding context clearly needs `.small` or `.mini`, such as dense inspector rows or compact toolbar groups.
- Use `.buttonStyle(.bordered)` for ordinary push buttons and `.buttonStyle(.borderedProminent)` for the single primary/default action in a surface.
- Use `.buttonStyle(.plain)` mainly for toolbar/icon buttons, list-row affordances, or custom clickable content that still has hover/focus affordances.
- macOS icon buttons should use SF Symbols where possible and provide `.help(...)` tooltips for ambiguous actions.
- Use native `Toggle` styles. Checkboxes fit most settings/form rows; switches are appropriate for standalone on/off settings; `.toggleStyle(.button)` or segmented/picker styles fit mutually exclusive modes.
- Avoid custom capsule toggles, hand-drawn segmented controls, and tap-only controls when the system component already provides pointer, focus, keyboard, and accessibility behavior.
- Append an ellipsis to a push button title when the action opens another window, sheet, popover, panel, or app where the user must provide more input.

## Forms And Settings

- Preferences and inspectors should use `Form`, `LabeledContent`, `Section`, and `.formStyle(.grouped)` or `.formStyle(.columns)` as appropriate.
- macOS form rows are compact and label-aligned. Settings-style pages avoid card piles and marketing-style panels.
- `LabeledContent` is the right default for value rows, picker rows, and read-only metadata rows.
- Section footers should explain consequences, privacy implications, or sync behavior. Avoid long explanatory text inside every row.
- System Settings and app Settings panes use clear sectioning, stable row heights, checkboxes/switches/pickers, and restrained typography.

## Lists And Tables

- Use `List` or `Table` for collections when native selection, focus, keyboard navigation, context menus, and row separators matter.
- Use `.listStyle(.sidebar)` for sidebars, `.inset` or `.plain` for content lists depending on density and selection needs, and `Table` for multicolumn sortable data.
- Rows that open, select, reveal, or mutate content need hover/focus affordances and context menus.
- Avoid rendering every list row as a large rounded card unless the content is genuinely card-like and not a source list or table.
- Standard collection context menus include relevant actions such as Open, Duplicate, Delete, Convert, Copy, Copy as Markdown, Reveal/Show in Finder, and Export when applicable.

## Typography

- Use SF Pro through SwiftUI system font styles. Avoid custom fixed-size type scales for structural chrome unless the user explicitly chose a font override for content.
- Large display fonts are uncommon in macOS productivity chrome. Prefer `.headline`, `.subheadline`, `.callout`, `.caption`, and occasional `.title3.weight(.semibold)` for pane headers.
- Use `.secondary` and `.tertiary` foreground styles for supporting text instead of lowering opacity manually.
- Use `.monospacedDigit()` for counts, timers, dates, and numeric metrics whose width changes during updates.
- Keep row labels short and scannable. Truncate long source-list and menu-bar-extra text rather than wrapping dense navigation rows.

## Color, Materials, And Dark Mode

- Use semantic colors and materials for chrome: `Color.primary`, `.secondary`, `.tertiary`, `Color.accentColor`, system backgrounds, and SwiftUI/AppKit materials.
- Preserve app-specific color schemes for user-facing content customization. The risk is using brand/custom colors for structural chrome that the system normally tints or materials.
- Let system accent color drive selection, prominent controls, and most sidebar symbols. Fixed colors are acceptable for content categories, calendars, badges, and status dots.
- Prefer adaptive colors over hardcoded light/dark values. Dark Mode should respect the user’s system appearance unless the app intentionally exposes a per-surface appearance setting.
- Materials such as `.regularMaterial` and `.thinMaterial` should be used sparingly for transient overlays, panels, popovers, and window-level utility surfaces, not as decorative paint on every card.
- Avoid root-pane opaque custom fills in `NavigationSplitView` sidebars; they fight desktop tinting and vibrancy.

## Popovers And Sheets

- Popovers are for transient, small, related edits near the invoking control or object. Calendar event editing is the canonical macOS example.
- Sheets are for modal tasks tied to the current window. On macOS they float over the parent window and should have clear default and cancel actions.
- Popovers should be compact and may contain a short `Form`. Large multi-section workflows belong in a sheet or dedicated window.
- Set reasonable fixed or ideal sizes for popovers/sheets; avoid full-screen iOS-sized panels.
- Use `.keyboardShortcut(.defaultAction)` and `.keyboardShortcut(.cancelAction)` on confirm/cancel buttons where applicable.

## Keyboard, Menus, And Focus

- Frequent commands need keyboard shortcuts and menu bar exposure. Prefer Command-key shortcuts for app actions.
- Return should activate a surface’s default action when there is one; Escape should cancel or dismiss transient UI.
- macOS users expect Tab traversal, focus rings, and keyboard-only navigation to work across forms, lists, and toolbars.
- Menu bar commands are the canonical list of app capabilities. Context menus should mirror relevant menu commands, not hide unique behavior.
- Avoid defining too many novel shortcuts; use standard shortcuts where the command matches platform precedent.

## Accessibility

- Icon-only controls need `.accessibilityLabel(...)` and `.help(...)`.
- Custom clickable rows need Button semantics or explicit accessibility traits and labels.
- Lists should preserve native selection and VoiceOver ordering. Avoid layouts where the visual order differs from accessibility order.
- Drag and drop should have non-drag alternatives through menus or buttons, because macOS users can perform drag and drop with pointer, keyboard accessibility, or VoiceOver.
- Use sufficient contrast in both Light and Dark Mode, especially for small secondary text.

## Context Menus

- Provide context menus consistently on interactive rows, cards, calendar items, kanban cards, sidebar collections, and editable content blocks.
- Keep menus short and relevant. Put destructive actions last and mark them destructive when supported.
- Do not display keyboard shortcuts inside context menus; shortcuts belong in app/menu bar commands.
- Hide unavailable context actions instead of showing a long disabled menu.

## Drag And Drop

- Use `.draggable` and `.dropDestination` for movable tasks, calendar items, kanban cards, imported files, and reorderable content where the model supports it.
- Show drop affordances only while dragging over valid destinations.
- Preserve undo for drag/drop mutations when feasible.
- Use standard drag previews or previews that closely match the dragged row/card without exaggerated animation.

## Menu Bar Extra Apps

- Menu bar extra icons should be monochromatic template-style symbols that adapt to the menu bar appearance.
- Dropdown panels should be compact, dense, and action-oriented. Long text belongs in the main window.
- Keep visible menu item labels short, generally under about 30 characters. Truncate or summarize long task/event names.
- Menu bar extras should expose a path to the main app window for fuller workflows.

## Animation

- Native macOS animation is restrained. Prefer short ease-in/ease-out transitions, native list insertion/deletion animation, and subtle hover feedback.
- Avoid iOS-style springy, bouncy, or decorative animation in productivity chrome.
- Animations should clarify state changes, not distract from repeated desktop work.

## Native Idioms To Watch For In HCB

- Custom sidebars, capsules, and cards replacing `NavigationSplitView`, source-list rows, `Form`, `List`, `Table`, or native buttons.
- App-specific colors used for toolbar/sidebar/window chrome instead of system accent, semantic color, or material.
- Large typography and roomy spacing in dense operational screens.
- Popovers or sheets that use bare `VStack` layouts where a compact `Form` would be more native.
- Missing context menus and keyboard shortcuts for task, calendar, kanban, and markdown operations.
- Menu bar extra content that reads like a full app panel instead of a compact status/menu surface.
- Detached windows that fail to propagate app appearance settings. HCB’s existing `.withHCBAppearance` pattern is correct and should be preserved.
