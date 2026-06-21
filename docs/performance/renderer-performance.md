# Renderer Performance

The renderer must stay responsive while showing dense task, calendar, note, and search surfaces. Most user-facing slowness will be visible here first.

## Rendering Rules

- Keep route-level state small. Store server/cache state in query hooks or preload-backed stores, not duplicated component trees.
- Render stable view models. Avoid recomputing grouping, sorting, recurrence expansion, or search ranking inside render.
- Virtualize large task, event, note, and search result lists.
- Keep command palette, quick capture, and sidebar always cheap to mount.
- Prefer CSS for visual states and simple animations.
- Avoid layout thrash: measure DOM only in narrow hooks and batch reads before writes.
- Avoid object rest destructuring on TanStack Query result objects because it can disable tracked-property optimizations.
- Use `select` in query hooks for small subscriptions such as counts and status badges.
- Use memoization only around proven expensive leaf components or stable selectors; do not blanket-wrap every component.

## View-Specific Guidance

Tasks:

- Precompute list grouping and sort order outside render.
- Virtualize long task lists and completed-history lists.
- Keep checkbox completion feedback optimistic and local.
- Avoid re-rendering an entire list when one task changes.

Calendar:

- Materialize or cache visible date ranges.
- Month and week views should render only visible days plus small overscan.
- Recurrence expansion belongs in a service/cache layer, not component render.
- Drag/resize interactions must update lightweight preview state before committing mutation work.

Search:

- Debounce only enough to avoid work per keypress; do not make typing feel delayed.
- Query local indexed data, not Google.
- Return capped result sets with a continuation strategy if needed.
- Highlight matches using precomputed ranges where possible.

Current measurement note, 2026-05-23:

- Final report-only Electron perf smoke collected app-side local search at 14.9ms cold / 3.5ms warm and Search UI at 38.97ms cold / 34.07ms warm after tightening the local search debounce.
- The perf smoke must run with the local native module rebuilt for Electron ABI; otherwise the app intentionally falls back to the Python compatibility adapter and the numbers are not representative of packaged runtime behavior.
- Remaining renderer performance watch: calendar month navigation is still above a single-frame target at roughly 38-41ms.

Current measurement note, 2026-05-24:

- The command palette and first-run setup dialog are split into deferred renderer chunks and preloaded after the shell-visible frame. The largest initial renderer asset moved from roughly 679 KiB to 656.5 KiB; total renderer output is roughly 717 KiB because the deferred chunks add wrapper overhead.
- The local perf smoke collected command palette open at 17.79ms cold / 8.97ms warm with the deferred command chunk preloaded after shell visibility.
- Search UI measured 154.82ms cold / 96.64ms warm in the same local run. The cold result is still affected by the app runtime's compatibility-path IPC latency on this machine.
- Remaining renderer performance watch: calendar month navigation is still above a single-frame target at roughly 39-43ms in stable warm/cold runs.

Command palette and quick capture:

- Keep initial command registry in memory.
- Lazy-load heavy command metadata.
- Opening the palette must not wait on network, database migration, or sync.

## Instrumentation

Use React Profiler or equivalent measurement in development/performance builds for:

- app shell
- sidebar
- task list
- calendar grid
- search results
- command palette
- settings

Collect render durations in local logs only when profiling is enabled. Do not enable expensive profiling in normal production builds.

Current scaffold note: renderer timing logs are gated behind `VITE_HCB_RENDER_PROFILING=true` or a dedicated performance build mode, and only write local component labels and durations.

## Anti-Patterns

- Mapping 10000 rows directly into DOM nodes.
- Re-sorting or regrouping full collections on every keystroke.
- Passing unstable object/function props through large subtrees without reason.
- Storing full raw Google payloads in renderer state.
- Doing date recurrence expansion in component render.
- Opening command palette by mounting the entire app settings/search stack.
