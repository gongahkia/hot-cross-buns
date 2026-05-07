# Vim Parity

The macOS editor uses a Vim-compatible mode for common Markdown editing workflows. This doc tracks what is supported, partial, and deliberately out of scope.

## Supported

- Modes: normal, insert, visual, visual line, visual block, replace, and operator-pending.
- Motions: `h j k l`, `w W b B e E`, `0 ^ $`, `gg G`, `f F t T`, `%`, `[[ ]]`, `{ }`, `n N`.
- Text objects: `iw aw is as ip ap i" a" i' a' i( a( i[ a[ i{ a{`.
- Operators: `d c y` with motions and text objects, visual-block operations, indent, and dedent.
- Search: `/`, `?`, `n`, `N`, `*`, `#`, `:nohlsearch`.
- Marks, macros, and registers.
- Ex commands used by the app: `:w`, `:s/.../.../[g]`, `:reg`, `:marks`, `:jumps`, and common search settings.

## Partial

- Jump list (`Ctrl-O` / `Ctrl-I`) records explicit jumps but not every cursor move.
- `:g/pattern/cmd` and `:v` work for common command combinations, but complex chained ranges can fail.
- Visual block paste can stretch one extra line when the register contains trailing newlines.

## Out Of Scope

- In-editor splits (`:sp`, `:vsp`); Melon Pan uses app-level tabs/windows.
- `:terminal`, `:tabnew`, and `:make`.
- Buffer-list commands (`:ls`, `:b{n}`); open documents are app-level state.
- Full terminal Vim parity for every plugin-style command.

## Test Plan

1. Toggle Vim mode and confirm the status indicator changes.
2. In normal mode, run `5j`, `dw`, `ciw`, `gg`, `G`, and `/foo<Enter>`.
3. Record a macro with `qa3jdjq`, then replay with `@a`.
4. Run `:s/old/new/g` on a line containing `old`.
5. Run `:w` and confirm the document saves locally.
6. Try one unsupported command and confirm it no-ops without surfacing an editor error.
