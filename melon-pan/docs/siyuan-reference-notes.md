# Siyuan Reference Notes

Melon Pan keeps `reference/siyuan` read-only. Siyuan is GPLv3, so these notes capture product and architecture lessons only; implementation is independent.

## Useful Lessons

- Split the durable document engine from the app shell. Siyuan's kernel/UI boundary validates Melon Pan's current split between `melon-pan-core` and platform apps.
- Treat the file tree as a first-class dock, not a throwaway list. The Drive browser should be compact, persistent, keyboard-friendly, and able to show document state inline.
- Keep a low-friction status surface visible. Save/sync/conflict feedback should live in the main window instead of only logs or modal dialogs.
- Prefer local durable state before remote sync. Melon Pan's `current.md`, `current.docs.json`, snapshots, and pending queue follow the same reliability principle while targeting Google Docs instead of Siyuan's local `.sy` files.
- Model documents structurally. Siyuan's block-tree approach reinforces that Melon Pan should preserve a typed Docs representation beside Markdown so sync/audit can reason about fidelity.
- Design direction should be dense and calm: Siyuan-like dock/sidebar mechanics, Notion-like page focus, muted surfaces, compact rows, and visible but quiet document state.

## Explicit Non-Goals

- Do not copy Siyuan source, stylesheets, icons, data formats, or GPL implementation details.
- Do not adopt Siyuan's full block editor model wholesale. Melon Pan remains Markdown-first with Google Docs as the source of truth.
- Do not make Drive browsing require broad Google Drive scopes for v1. The high-level plan still favors `drive.file` plus Docs scope unless the product decision changes.
