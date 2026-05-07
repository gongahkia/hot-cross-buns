# Vim Mode

Enable Vim mode in Settings, under the Editor section. The macOS editor uses Melon Pan's `NSTextView` Vim controller so modal editing stays inside the native editor while app-level shortcuts stay in the shell.

Phase 1 covers core motions, operators, visual mode, text objects, search, yank, delete, change, put, undo, redo, and a small ex command subset such as :w and :nohlsearch.

Phase 2 covers macros, substitution with :s, ex ranges, jump list behavior, and split-style workflows. Split panes are shell-owned, so exact behavior may differ from terminal Vim.

Phase 3 tracks folding, :g and :v, gq formatting, and Ctrl-a or Ctrl-x increment and decrement. MELON-PAN.md section 6.2 remains the named upstream Vim target in the feature plan.

If a Vim binding does not behave like terminal Vim, check whether the editor controller owns it or whether the app shell intercepted it as a native shortcut.
