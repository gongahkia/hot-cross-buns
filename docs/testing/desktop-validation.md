# Desktop validation

Run the complete local gate before declaring UI work finished:

```sh
pnpm test:validate
```

This builds and typechecks the production app, runs Vitest, runs the SQLite/sync suite under Electron's native ABI, then drives the actual Electron app with Playwright. Linux runs use a separate Xvfb display (install `xvfb` if needed). Each app fixture uses a temporary profile and database; it never opens your development profile.

For focused iteration after a build:

```sh
pnpm test:ui tests/smoke/controls-and-motion.spec.ts
pnpm exec playwright show-report output/playwright-report
```

Do not build while UI tests are running: the build replaces the renderer assets being tested. Keep Electron tests sequential because native menus and global shortcuts share a desktop.

## Evidence and coverage

The gate retains an HTML report and JUnit results under `output/`, screenshots under `output/ui-review/`, and failed-test screenshots and traces under `output/playwright/`. CI runs the gate stages on Linux and macOS and uploads those artifacts. Screenshots are inspection evidence; they are not pixel-baseline assertions.

The interaction suite opens real dropdowns with mouse and keyboard, checks that options have text and fit the window, selects values, dismisses nested menus, and checks focus returns to the owning field. It covers Settings, task/event editors, date and time pickers, empty choices, leap day, autosave, and persistence after reload. Calendar tests switch Day, Week, Month, Agenda, preset day counts and custom counts, check reduced motion and disabled animations, and exercise creating, moving, resizing and completing events. Existing workflows cover search, conversions, notes, Markdown, clipboard, backup, migration and navigation.

Use `chooseOption`/`chooseOptionValue` from `tests/smoke/controls.ts` for dropdowns. Native `selectOption()` changes a value without proving that its popup paints; it missed the blank WSLg menus. Seed fixtures through IPC, then perform the behavior under test through visible controls and assert persisted results. Do not replace interaction assertions with screenshots or direct API writes.

This approach follows [Gator's desktop workflow tests](https://github.com/gongahkia/gator/blob/7ecb134281c85aeb97c5e6ffeb2baf1d6a846b49/desktop/tests/e2e/polish.spec.ts) and [CI checks](https://github.com/gongahkia/gator/blob/7ecb134281c85aeb97c5e6ffeb2baf1d6a846b49/.github/workflows/ci.yml): isolated app launches, real interactions, persisted-state assertions, and retained evidence.

## Populated account review

`tests/smoke/populated-planner.spec.ts` runs in the normal validation gate, in both themes. Its disposable local account contains 493 events across 90 days, 24 recurring birthdays, 600 tasks across six lists (including subtasks, completed work and 60 dated tasks), and 240 Markdown notes, including long documents. It uses real IPC and SQLite with a fixed renderer clock of October 22, 2026, at 15:49 UTC. No Google credentials or development data are used.

The test opens Month, Week, Day and three-day views. It checks actual painted rectangles for overlapping/clipped timed cards, bounded month lanes and accessible overflow, completion styling, full accessible labels for truncated titles, rare search results, task virtualization, opening a long note, and the narrow search inspector. Screenshots cover each view, overflow, search, tasks and notes. Inspect `output/ui-review/populated-*.png` alongside the experimental reference; these are review artifacts, not pixel-diff baselines or a guarantee of subjective readability.

Each theme also produces `populated-performance-<theme>.json`, attached to the HTML report. Measurements start on the actual view-menu click and finish after the incoming grid settles, including its animation. A 400 ms target is reported alongside a 1,500 ms regression ceiling. Frame timing samples are retained for diagnosis; a single short animation has too few frames for a stable percentile gate. Sustained frame timing budgets live in the load suite. These bounded transition samples supplement the more extensive `test:perf` load suite (1k/5k/10k of each entity); they do not claim a sustained frame rate or performance on all hardware. The large load suite is a separate command, not part of `test:validate`.

Run this scenario alone after a build with `pnpm test:ui tests/smoke/populated-planner.spec.ts`. Test coverage cannot completely validate UI/UX: review the retained screenshots and use the app with representative data on target platforms as well.

## Limits

The local gate uses the production build launched by Electron, not an installed/signed package. Run the existing packaged-app and live-Google suites separately for release and provider validation; those require the appropriate platform or a dedicated signed-in test account. An Xvfb pass verifies renderer-owned menus, not every compositor/driver combination. Check the reported WSLg behavior in the normal development window as well.

The Select dependency is pinned to 2.3.7 to share the same Radix focus-scope and dismissable-layer versions as Dialog and Popover. When upgrading these primitives, upgrade them together and run the nested-menu keyboard tests: separate focus stacks can steal focus or dismiss an enclosing dialog.
