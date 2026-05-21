# Build And Test Performance

The rebuild exists partly to improve development velocity. Build and test speed are product infrastructure, not developer comfort only.

## Development Loop Goals

Targets:

- Dev server ready quickly enough for iterative UI work.
- Unit tests run in seconds for focused scopes.
- Electron smoke tests stay small and deterministic.
- Performance tests report stable local numbers without needing network access.
- Native packaging is separated from everyday typecheck/test loops.

## Vite Guidance

Follow Vite's performance guidance as the project grows:

- Keep plugin count low.
- Avoid slow work in startup hooks.
- Dynamically import large dependencies used only in rare flows.
- Use explicit import extensions in hot paths if resolution becomes expensive.
- Avoid transforming SVGs into React components by default; use URLs or strings for non-interactive assets.
- Use Vite profiling tools when dev server startup or reloads become slow.

## Test Suite Shape

Keep test layers separate:

- `test:unit`: domain and renderer unit tests
- `test:db`: SQLite migration/repository tests
- `test:ipc`: preload and IPC contract tests
- `test:mcp`: MCP contract tests
- `test:smoke`: Playwright Electron smoke tests
- `test:perf`: local performance smoke tests

The default `test` command should run reliable checks. Expensive performance and packaging checks may be opt-in until release gates require them.

## Performance Smoke Tests

Performance smoke tests should:

- generate local fixture data deterministically
- avoid Google network calls
- avoid real user app data paths
- record timings to a machine-readable artifact
- compare against soft budgets first
- become hard gates only after stable baselines exist

Suggested artifacts:

```text
artifacts/perf/latest.json
artifacts/perf/latest.md
```

Do not commit generated performance artifacts unless a release checklist specifically asks for a baseline sample.

## Bundle And Dependency Hygiene

- Keep renderer dependencies separate from main-only dependencies.
- Avoid shipping test-only and build-only libraries in runtime bundles.
- Lazy-load settings, diagnostics, large editors, and rarely used panels.
- Keep native modules behind adapters.
- Review bundle size before release packaging.

## CI Strategy

When CI exists:

- Run typecheck and unit tests on every PR.
- Run SQLite and IPC contracts on every PR.
- Run Playwright smoke on PRs that touch app shell, preload, main, or renderer routes.
- Run performance smoke nightly or before release until thresholds stabilize.
- Run packaging on release branches or tags.

