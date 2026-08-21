# Local Python TUI/CLI smoke

Use this procedure on a candidate wheel with networking disabled. It complements,
but does not replace, the automated suite or the live Google procedure.

## Isolated install

1. Build with `python -m build`.
2. Create a new virtual environment outside the repository.
3. Install only the generated wheel with `python -m pip install dist/*.whl`.
4. Run `hcb --json-schema-version`, `hcb --help`, and `TERM=dumb NO_COLOR=1 hcb --help`.
   The schema version must be `1`; help must contain no escape sequences.

## Fresh and cached startup

1. Point `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` at an empty
   temporary directory and start `hcb`.
2. Confirm first-run setup says Google is optional until an explicit connection,
   asks for a Desktop OAuth JSON path (never a secret), account, IANA timezone,
   theme, and reminders.
3. Save an offline account, create a task list, task, calendar, and event using the
   CLI, then restart the TUI with the network disabled. Confirm cached rows appear.
4. Switch Tasks, Notes, Agenda, Day, Week, and Month. Exercise create, edit,
   complete, delete confirmation, scheduling, undo/redo, import preview, settings,
   conflicts, calendar management, and command-palette actions.

## Terminal behavior

1. Resize from at least 120x38 to 44x18 and back. The inspector must collapse and
   restore, selection must remain stable, and long titles must visibly truncate or
   remain scroll-reachable.
2. Repeat with CJK text and emoji in selected titles.
3. Run with `NO_COLOR=1` and with the mono theme. Status must remain understandable
   without color, borders must be ASCII, and mouse use must be optional.
4. Pipe JSON and TSV output to files. No full-screen TUI or ANSI sequence may open
   in a pipe. TSV rows must retain a fixed column count.

## Persistence and diagnostics

1. Queue offline creates, quit, reopen, and confirm the pending count and records
   remain. Undo an unpushed create and confirm both row and mutation disappear.
2. Run `hcb doctor --json`. It may contain counts, enums, schema/integrity state,
   and redacted paths only—never email, subject, titles, notes, OAuth material, or
   local absolute paths.
3. Disconnect and confirm cache remains. Run the separately confirmed reset command
   and confirm account cache and credentials are removed.

## Automated scale check

Run `python tools/benchmark_python.py`. The deterministic fixture contains 10,000
tasks and 2,000 events. The enforced regression tripwires are 5 seconds each for
cold database open, 10k local search, one-month agenda query, and interactive cache
load. These broad limits are intended to be stable on shared CI, not to advertise
latency.
