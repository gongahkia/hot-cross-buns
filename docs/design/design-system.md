# Design System

Hot Cross Buns 2 inherits the compact, keyboard-first design direction from the original Hot Cross Buns app, but implements it with React, Tailwind, and CSS custom properties.

## Principles

- Compact density: default text is 13-14px and surfaces should show many tasks/events without feeling cramped.
- Soft structure: use 8px radius for most controls and cards; avoid oversized rounded marketing UI.
- Polished motion: use short 150-250ms transitions for hover, selection, panels, and completion state changes.
- Work surface first: the first viewport is the planner, not a landing page.
- Data integrity before polish: loading, offline, error, conflict, and retry states must be explicit.

## Color Tokens

Use semantic CSS variables in components. Palette variables may exist in global CSS, but component code should consume semantic tokens.

Dark theme:

| Token | Value | Usage |
|---|---:|---|
| `--color-bg-primary` | `#1e1e2e` | App background |
| `--color-bg-secondary` | `#181825` | Sidebar and secondary panels |
| `--color-bg-tertiary` | `#11111b` | Deep background |
| `--color-surface-0` | `#313244` | Inputs and cards |
| `--color-surface-1` | `#45475a` | Hover state |
| `--color-surface-2` | `#585b70` | Active/pressed state |
| `--color-text-primary` | `#cdd6f4` | Body text |
| `--color-text-secondary` | `#bac2de` | Secondary labels |
| `--color-text-muted` | `#a6adc8` | Placeholders and hints |
| `--color-border` | `#45475a` | Default borders |
| `--color-accent` | `#89b4fa` | Primary actions |
| `--color-danger` | `#f38ba8` | Delete, errors, overdue |
| `--color-warning` | `#fab387` | Warnings |
| `--color-success` | `#a6e3a1` | Completed/success |
| `--color-info` | `#89dceb` | Informational |

Light theme:

| Token | Value | Usage |
|---|---:|---|
| `--color-bg-primary` | `#eff1f5` | App background |
| `--color-bg-secondary` | `#e6e9ef` | Sidebar and secondary panels |
| `--color-bg-tertiary` | `#dce0e8` | Deep background |
| `--color-surface-0` | `#ccd0da` | Inputs and cards |
| `--color-surface-1` | `#bcc0cc` | Hover state |
| `--color-surface-2` | `#acb0be` | Active/pressed state |
| `--color-text-primary` | `#4c4f69` | Body text |
| `--color-text-secondary` | `#5c5f77` | Secondary labels |
| `--color-text-muted` | `#6c6f85` | Placeholders and hints |
| `--color-border` | `#bcc0cc` | Default borders |
| `--color-accent` | `#1e66f5` | Primary actions |
| `--color-danger` | `#d20f39` | Delete, errors, overdue |
| `--color-warning` | `#fe640b` | Warnings |
| `--color-success` | `#40a02b` | Completed/success |
| `--color-info` | `#04a5e5` | Informational |

Priority colors:

| Priority | Dark | Light |
|---|---:|---:|
| None | `transparent` | `transparent` |
| Low | `#89b4fa` | `#1e66f5` |
| Medium | `#fab387` | `#fe640b` |
| High | `#f38ba8` | `#d20f39` |

## Typography

Use system fonts:

```css
--font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
--font-family-mono: "SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", ui-monospace, monospace;
```

Type scale:

| Token | Size | Weight | Use |
|---|---:|---:|---|
| `--text-xs` | 11px | 400 | Badges and timestamps |
| `--text-sm` | 12px | 400 | Metadata and secondary text |
| `--text-base` | 13px | 400 | Body text |
| `--text-md` | 14px | 500 | Task titles and inputs |
| `--text-lg` | 16px | 600 | Section headers |
| `--text-xl` | 20px | 700 | View titles |
| `--text-2xl` | 24px | 700 | Onboarding headers only |

Do not scale fonts with viewport width. Do not use negative letter spacing.

## Spacing, Radius, Motion

Spacing is based on 4px:

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px

Radius:

- `--radius-sm`: 4px
- `--radius-md`: 8px
- `--radius-lg`: 12px, reserved for modals and larger panels
- `--radius-full`: badges, dots, avatars only

Motion:

- `--duration-fast`: 150ms
- `--duration-normal`: 200ms
- `--duration-slow`: 350ms
- `--easing-default`: `cubic-bezier(0.4, 0, 0.2, 1)`

## Component Conventions

- Use icons inside compact buttons where a familiar icon exists.
- Use text buttons only for commands whose meaning would be ambiguous as an icon.
- Keep app sections unframed; use cards for repeated items, popovers, dialogs, and task/event rows.
- Do not nest cards inside cards.
- Use visible focus states for all keyboard-reachable controls.
- Use virtualized lists for large task/event/note collections.
- Keep toolbar and sidebar controls stable in size so counts, badges, and loading states do not shift layout.

## Visual Assets

The original repository has app icons, logo files, onboarding images, and demo media under:

```text
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/asset
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/docs/media
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/docs/assets
```

Agents may reference these assets when designing Hot Cross Buns 2. Copy assets into this repository only when an implementation or design task actually needs them.

Current copied brand assets live under `assets/brand/`. The macOS package icon is generated as `build/icon.icns` from the legacy AppIcon set, the renderer sidebar uses the 64 px derivative `assets/brand/buns-app-icon-sidebar.png`, and the native macOS menu bar item uses `assets/brand/menubar-template.png`.
