# Customization: CSS and JSON

Hot Cross Buns reads user customization from the app config directory.

- `settings.json`: safe UI overrides such as theme, layout scale, navigation order, visible calendar modes, semantic search, and the agent action tray.
- `keymap.json`: `keybindings`, `leaderKey`, and `leaderKeybindings`.
- `snippets/*.css`: disabled by default until enabled in Settings.

CSS snippets are loaded into the renderer only after Settings enables them. Snippets should prefer app CSS variables such as `--color-accent`, `--text-base`, `--text-primary`, `--surface-0`, and `--border`.

Create a `safe-mode` file in the config directory to stop snippets and extensions from loading.
