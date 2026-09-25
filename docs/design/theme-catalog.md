# Theme Catalogue

Hot Cross Buns ships 50 curated editor and terminal colour schemes: 34 dark and 16 light. They are selectable in **Settings → Appearance**. The Base colour scheme controls whether the picker shows light or dark palettes; when a selected family has a paired palette, changing base mode selects its pair automatically.

This is a curation of highly recognisable VS Code and Ghostty-compatible schemes, not a claim of a globally precise install ranking. VS Code Marketplace counts change continuously and Ghostty ships hundreds of themes. Ghostty documents that its built-ins are sourced from the iTerm2 Color Schemes collection; HCB uses the canonical background, foreground, and ANSI accent values from that MIT-licensed collection to derive its UI semantics. See [Ghostty themes](https://ghostty.org/docs/features/theme), [iTerm2 Color Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes), [One Dark Pro on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme), and [Dracula for VS Code](https://marketplace.visualstudio.com/items?itemName=dracula-theme.theme-dracula).

Attribution: selected terminal values are derived from the iTerm2 Color Schemes collection, Copyright © 2011–present Mark Badolato, MIT; individual theme authors retain their respective attribution. HCB does not vendor the collection or terminal configuration files.

## Dark

- One Dark Pro
- Dracula; Dracula+
- Catppuccin Mocha; Catppuccin Macchiato; Catppuccin Frappe
- Tokyo Night; Tokyo Night Storm; Tokyo Night Moon
- Nord; Nord Wave
- Gruvbox Dark; Gruvbox Dark Hard; Gruvbox Material Dark
- Solarized Dark
- Monokai Pro
- Ayu Dark; Ayu Mirage
- GitHub Dark Default; GitHub Dark Dimmed
- Material Darker; Material Ocean
- Night Owl
- Cobalt2
- Shades of Purple
- SynthWave '84
- Rosé Pine; Rosé Pine Moon
- Kanagawa Wave; Kanagawa Dragon
- Everforest Dark
- Atom One Dark
- Oxocarbon
- Vesper

## Light

- Catppuccin Latte
- Tokyo Night Day
- Nord Light
- Gruvbox Light; Gruvbox Material Light
- Solarized Light
- Monokai Pro Light
- Ayu Light
- GitHub Light Default; GitHub Light High Contrast
- Material Light
- Night Owlish Light
- Rosé Pine Dawn
- Kanagawa Lotus
- Everforest Light
- Atom One Light

## Implementation rules

- Palette definitions live in `src/shared/ipc/themeCatalog.ts`; components consume semantic CSS variables rather than palette hex values.
- Every palette maps background, layered surfaces, primary/secondary/muted text, borders, accent, status colours, selection, priorities, Calendar chips, focus rings, and primary-control text.
- The catalogue automatically moves accent and status colours toward a neutral endpoint when needed for 4.5:1 contrast against its background. That preserves theme hue while keeping text and compact controls readable.
- Custom image backgrounds derive the same complete semantic shape. Old one-colour custom-background settings are upgraded lazily when loaded.
- Google Calendar colours remain user-overridable. If no override exists, HCB derives its default/blue/green/red event chips from the active palette.

## Adding a palette

Add exactly one `dark(...)` or `light(...)` seed in `themeCatalog.ts`, using a stable slug, family, source, canonical background/foreground, and ANSI red/green/yellow/blue/cyan. If it has a mode pair, reuse the family slug. The theme-catalog test requires unique IDs, exactly 50 entries, and contrast coverage for all semantic text/status/selection surfaces; update the expected count and this document in the same change.
