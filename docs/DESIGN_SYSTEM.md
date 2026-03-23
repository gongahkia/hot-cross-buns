# Design System

Visual design tokens and component specs for Cross 2. All values map to CSS custom properties and Tailwind config.

See also: [STYLE_GUIDE.md](./STYLE_GUIDE.md) for code conventions, [ARCHITECTURE.md](./ARCHITECTURE.md) for component file locations.

---

## Design Principles

- **Soft & rounded** — 8-12px corners, gentle shadows, smooth transitions
- **Compact density** — 13-14px base text, tighter spacing, more visible tasks
- **Polished & fluid** — 200-350ms animations with easing curves
- **Correctness > UX > Speed** — data integrity first, then polish, then velocity

---

## Color System

### Catppuccin Mocha (Dark Theme)

| Token | Name | Hex |
|---|---|---|
| `--ctp-rosewater` | Rosewater | `#f5e0dc` |
| `--ctp-flamingo` | Flamingo | `#f2cdcd` |
| `--ctp-pink` | Pink | `#f5c2e7` |
| `--ctp-mauve` | Mauve | `#cba6f7` |
| `--ctp-red` | Red | `#f38ba8` |
| `--ctp-maroon` | Maroon | `#eba0ac` |
| `--ctp-peach` | Peach | `#fab387` |
| `--ctp-yellow` | Yellow | `#f9e2af` |
| `--ctp-green` | Green | `#a6e3a1` |
| `--ctp-teal` | Teal | `#94e2d5` |
| `--ctp-sky` | Sky | `#89dceb` |
| `--ctp-sapphire` | Sapphire | `#74c7ec` |
| `--ctp-blue` | Blue | `#89b4fa` |
| `--ctp-lavender` | Lavender | `#b4befe` |
| `--ctp-text` | Text | `#cdd6f4` |
| `--ctp-subtext1` | Subtext 1 | `#bac2de` |
| `--ctp-subtext0` | Subtext 0 | `#a6adc8` |
| `--ctp-overlay2` | Overlay 2 | `#9399b2` |
| `--ctp-overlay1` | Overlay 1 | `#7f849c` |
| `--ctp-overlay0` | Overlay 0 | `#6c7086` |
| `--ctp-surface2` | Surface 2 | `#585b70` |
| `--ctp-surface1` | Surface 1 | `#45475a` |
| `--ctp-surface0` | Surface 0 | `#313244` |
| `--ctp-base` | Base | `#1e1e2e` |
| `--ctp-mantle` | Mantle | `#181825` |
| `--ctp-crust` | Crust | `#11111b` |

### Catppuccin Latte (Light Theme)

| Token | Name | Hex |
|---|---|---|
| `--ctp-rosewater` | Rosewater | `#dc8a78` |
| `--ctp-flamingo` | Flamingo | `#dd7878` |
| `--ctp-pink` | Pink | `#ea76cb` |
| `--ctp-mauve` | Mauve | `#8839ef` |
| `--ctp-red` | Red | `#d20f39` |
| `--ctp-maroon` | Maroon | `#e64553` |
| `--ctp-peach` | Peach | `#fe640b` |
| `--ctp-yellow` | Yellow | `#df8e1d` |
| `--ctp-green` | Green | `#40a02b` |
| `--ctp-teal` | Teal | `#179299` |
| `--ctp-sky` | Sky | `#04a5e5` |
| `--ctp-sapphire` | Sapphire | `#209fb5` |
| `--ctp-blue` | Blue | `#1e66f5` |
| `--ctp-lavender` | Lavender | `#7287fd` |
| `--ctp-text` | Text | `#4c4f69` |
| `--ctp-subtext1` | Subtext 1 | `#5c5f77` |
| `--ctp-subtext0` | Subtext 0 | `#6c6f85` |
| `--ctp-overlay2` | Overlay 2 | `#7c7f93` |
| `--ctp-overlay1` | Overlay 1 | `#8c8fa1` |
| `--ctp-overlay0` | Overlay 0 | `#9ca0b0` |
| `--ctp-surface2` | Surface 2 | `#acb0be` |
| `--ctp-surface1` | Surface 1 | `#bcc0cc` |
| `--ctp-surface0` | Surface 0 | `#ccd0da` |
| `--ctp-base` | Base | `#eff1f5` |
| `--ctp-mantle` | Mantle | `#e6e9ef` |
| `--ctp-crust` | Crust | `#dce0e8` |

### Semantic Color Mappings

Components consume these tokens, not raw palette values. Defined per theme via `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`.

| Semantic Token | Dark (Mocha) | Light (Latte) | Usage |
|---|---|---|---|
| `--color-bg-primary` | `#1e1e2e` (base) | `#eff1f5` (base) | App background |
| `--color-bg-secondary` | `#181825` (mantle) | `#e6e9ef` (mantle) | Sidebar background |
| `--color-bg-tertiary` | `#11111b` (crust) | `#dce0e8` (crust) | Deepest background layer |
| `--color-surface-0` | `#313244` (surface0) | `#ccd0da` (surface0) | Cards, input fields |
| `--color-surface-1` | `#45475a` (surface1) | `#bcc0cc` (surface1) | Hover states |
| `--color-surface-2` | `#585b70` (surface2) | `#acb0be` (surface2) | Active/pressed states |
| `--color-text-primary` | `#cdd6f4` (text) | `#4c4f69` (text) | Body text |
| `--color-text-secondary` | `#bac2de` (subtext1) | `#5c5f77` (subtext1) | Secondary labels |
| `--color-text-muted` | `#a6adc8` (subtext0) | `#6c6f85` (subtext0) | Placeholders, hints |
| `--color-text-faint` | `#6c7086` (overlay0) | `#9ca0b0` (overlay0) | Disabled text |
| `--color-border` | `#45475a` (surface1) | `#bcc0cc` (surface1) | Default borders |
| `--color-border-subtle` | `#313244` (surface0) | `#ccd0da` (surface0) | Subtle separators |
| `--color-accent` | `#89b4fa` (blue) | `#1e66f5` (blue) | Primary actions, links |
| `--color-accent-hover` | `#b4befe` (lavender) | `#7287fd` (lavender) | Accent hover state |
| `--color-danger` | `#f38ba8` (red) | `#d20f39` (red) | Delete, errors, overdue |
| `--color-warning` | `#fab387` (peach) | `#fe640b` (peach) | Warnings |
| `--color-success` | `#a6e3a1` (green) | `#40a02b` (green) | Completed, success |
| `--color-info` | `#89dceb` (sky) | `#04a5e5` (sky) | Informational |

### Priority Colors

| Priority | Token | Dark | Light | Indicator |
|---|---|---|---|---|
| 0 (None) | `--color-priority-none` | `transparent` | `transparent` | No border |
| 1 (Low) | `--color-priority-low` | `#89b4fa` (blue) | `#1e66f5` (blue) | Blue left border |
| 2 (Medium) | `--color-priority-med` | `#fab387` (peach) | `#fe640b` (peach) | Orange left border |
| 3 (High) | `--color-priority-high` | `#f38ba8` (red) | `#d20f39` (red) | Red left border |

### List Preset Colors

12 preset colors for list customization (dark / light values):

| Name | Dark | Light |
|---|---|---|
| Red | `#f38ba8` | `#d20f39` |
| Peach | `#fab387` | `#fe640b` |
| Yellow | `#f9e2af` | `#df8e1d` |
| Green | `#a6e3a1` | `#40a02b` |
| Teal | `#94e2d5` | `#179299` |
| Sky | `#89dceb` | `#04a5e5` |
| Blue | `#89b4fa` | `#1e66f5` |
| Lavender | `#b4befe` | `#7287fd` |
| Mauve | `#cba6f7` | `#8839ef` |
| Pink | `#f5c2e7` | `#ea76cb` |
| Flamingo | `#f2cdcd` | `#dd7878` |
| Rosewater | `#f5e0dc` | `#dc8a78` |

---

## Typography

### Font Stack

```css
--font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI',
  system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif;

--font-family-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono',
  ui-monospace, monospace;
```

### Type Scale

| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `--text-xs` | 11px | 400 | 1.4 | Badges, timestamps |
| `--text-sm` | 12px | 400 | 1.4 | Secondary text, metadata |
| `--text-base` | 13px | 400 | 1.5 | Body text (compact density) |
| `--text-md` | 14px | 500 | 1.5 | Task titles, input text |
| `--text-lg` | 16px | 600 | 1.4 | Section headers, list names |
| `--text-xl` | 20px | 700 | 1.3 | View titles ("Today", "Calendar") |
| `--text-2xl` | 24px | 700 | 1.2 | App name, onboarding headers |

---

## Spacing

Base unit: **4px**. All spacing derives from this.

| Token | Value | Usage |
|---|---|---|
| `--space-0` | 0px | — |
| `--space-1` | 4px | Tight padding, icon gaps |
| `--space-2` | 8px | Default inner padding |
| `--space-3` | 12px | Card padding, between list items |
| `--space-4` | 16px | Section margins |
| `--space-5` | 20px | Between major sections |
| `--space-6` | 24px | Subtask indentation |
| `--space-8` | 32px | Panel margins |

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4px | Small badges, checkboxes |
| `--radius-md` | 8px | Buttons, inputs, tag pills |
| `--radius-lg` | 12px | Cards, panels, modals |
| `--radius-full` | 9999px | Avatars, color dots |

---

## Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.1)` | Subtle element lift |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.15)` | Cards, dropdowns |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.2)` | Modals, floating panels |

In dark theme, use higher opacity multipliers (`0.3`, `0.4`, `0.5`) since shadows are less visible on dark backgrounds.

---

## Animation

| Token | Value | Usage |
|---|---|---|
| `--duration-fast` | 150ms | Checkboxes, toggles |
| `--duration-normal` | 200ms | Hover effects, color changes |
| `--duration-slow` | 350ms | Panel slide-in, view transitions |
| `--easing-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | General transitions |
| `--easing-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elements entering view |
| `--easing-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elements leaving view |
| `--easing-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful feedback (checkbox tick) |

---

## Component Specs

### Layout

```
┌─────────────────────────────────────────────────────┐
│ Toolbar (48px height)                                │
├──────────┬──────────────────────┬───────────────────┤
│ Sidebar  │    Task List         │   Task Detail     │
│ 250px    │    flex: 1           │   400px           │
│          │                      │   (slide-in)      │
│          │                      │                   │
│          │                      │                   │
├──────────┴──────────────────────┴───────────────────┤
│                  min-width: 800px                     │
│                  min-height: 600px                    │
│                  default: 1200x800                    │
└─────────────────────────────────────────────────────┘
```

### Sidebar

- Width: **250px** fixed
- Background: `--color-bg-secondary`
- List items: **36px** height, `--space-2` padding-left, `--radius-md` on hover
- Active item: `--color-surface-0` background
- Color dot: **6px** circle, `--radius-full`, list color
- Task count badge: `--text-xs`, `--color-text-muted`, right-aligned
- Separator between list groups: 1px `--color-border-subtle`

### Task Row

- Height: **40px** minimum
- Left border: **3px** solid, colored by priority (see Priority Colors)
- Checkbox: **18px**, `--radius-sm`, `--color-border` stroke, `--color-accent` fill when checked
- Title: `--text-md`, `--color-text-primary`; strikethrough + `--color-text-muted` when completed
- Due badge: `--text-xs`, `--radius-md` pill; `--color-danger` background if overdue, `--color-surface-1` otherwise
- Tag pills: `--text-xs`, `--radius-md`; colored background at 20% opacity, full-color text
- Subtask indent: `--space-6` left margin
- Hover: `--color-surface-1` background with `--duration-normal` transition

### Task Detail Panel

- Width: **400px**, slides in from right
- Background: `--color-bg-primary`
- Border-left: 1px `--color-border-subtle`
- Slide animation: `--duration-slow` with `--easing-out`
- Input fields: `--color-surface-0` background, `--radius-md`, `--space-2` padding
- Section spacing: `--space-4` between field groups

### Buttons

| Variant | Background | Text | Border |
|---|---|---|---|
| Primary | `--color-accent` | `--color-bg-primary` | none |
| Secondary | `transparent` | `--color-accent` | 1px `--color-accent` |
| Danger | `--color-danger` | `#ffffff` | none |
| Ghost | `transparent` | `--color-text-secondary` | none |

- Height: **32px**
- Padding: `--space-2` horizontal
- Font: `--text-sm`, weight 500
- Radius: `--radius-md`
- Disabled: 50% opacity, `cursor: not-allowed`
- Hover: lighten/darken background with `--duration-normal` transition

### Context Menu

- Background: `--color-surface-0`
- Shadow: `--shadow-lg`
- Radius: `--radius-lg`
- Item height: **32px**, `--text-sm`, `--space-3` horizontal padding
- Item hover: `--color-surface-1` background
- Danger items: `--color-danger` text color
- Separator: 1px `--color-border-subtle`, `--space-1` vertical margin

### Toasts / Notifications

- Position: bottom-right, `--space-4` from edges
- Background: `--color-surface-0`
- Shadow: `--shadow-md`
- Radius: `--radius-lg`
- Auto-dismiss: 4 seconds
- Enter: slide up + fade in (`--duration-slow`, `--easing-out`)
- Exit: fade out (`--duration-normal`, `--easing-in`)

---

## Keyboard Shortcuts

Minimal defaults:

| Shortcut | Action |
|---|---|
| `Ctrl+N` | Focus quick-add input |
| `Ctrl+Z` | Undo last action |
| `Ctrl+F` | Focus search bar |
| `Delete` | Delete selected task (with confirmation) |
| `Escape` | Close panel / deselect |
| `?` | Show shortcuts modal |

---

## Accessibility

- **Contrast:** minimum 4.5:1 ratio (WCAG 2.1 AA)
- **Focus ring:** 2px solid `--color-accent`, 2px offset
- **ARIA:** labels on all interactive elements
- **Keyboard nav:** full Tab + Arrow key navigation
- **Motion:** respect `prefers-reduced-motion` — disable animations when set
- **Screen reader:** meaningful alt text, live regions for toast notifications
