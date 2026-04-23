# Localization

Hot Cross Buns is English-only for v1 but ships with a String Catalog scaffold so future translations require only adding languages, not refactoring source.

## How it works

Every `Text("literal string")` in SwiftUI is implicitly a `LocalizedStringKey`. If the literal appears as a key in `apps/apple/Resources/Localizable.xcstrings`, SwiftUI returns the localised value for the user's current locale; otherwise it falls back to the key itself. That means we do not have to wrap existing `Text` sites — adding a key to the catalogue automatically makes the matching `Text("Key")` localisable.

The catalogue is a JSON string-catalog (`.xcstrings`) introduced in Xcode 15. Xcode's editor renders it as a table; the file format is plain JSON so it also edits cleanly in any text editor.

## Adding a new translatable string

1. Add the key + English value to `apps/apple/Resources/Localizable.xcstrings`.
2. Use `Text("Your key")` (or `LocalizedStringKey("Your key")` in non-`Text` contexts) as normal in Swift source.
3. When adding a new locale later, `extractionState` becomes `translated` once the translator fills each `stringUnit`.

## Adding a new language

1. Open the catalogue in Xcode.
2. Press "+" in the locale row, pick e.g. `fr`.
3. Translate each entry. Xcode populates missing keys automatically next build.
4. Add `<lang>.lproj` to `CFBundleLocalizations` in `Info.plist` if not auto-handled.

## What's currently in scope

The catalogue currently holds a small set of anchor strings used across the sidebar and primary toolbar (`Calendar`, `Store`, `Today`, `Refresh`, `Add Task`, `Add Event`). Additional strings should be added as they prove to be user-facing surface the maintainer wants localised. We intentionally did not bulk-wrap the whole codebase — English-only users see identical output whether or not a string is in the catalogue, so the cost of not pre-populating is zero.

## Non-goals

- Right-to-left layout support (would need UI auditing beyond string-swap).
- Pluralisation rules (macOS String Catalogs support `%lld tasks` variants; add when a plural string surfaces).
- Dynamic language switching at runtime (standard macOS locale workflow is restart-to-apply).
