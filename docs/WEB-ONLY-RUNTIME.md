# Browser application and private Go runtime

The browser is the application frontend. Run `make run`; Go and Node are the
build requirements. The runtime is built in `runtime/` by
`scripts/build-runtime.mjs`, independently of any frontend package.

The Solid/OpenTUI frontend, Bun launcher, terminal packaging/installers, terminal
release workflow, and frontend-specific tests have been retired. Their last
verified source is retained at Git checkpoint `9644043e0`.

The Go executable no longer launches an interactive UI or accepts ordinary public
CLI commands. Help points to the browser; version remains available to the host.
The host explicitly marks private services. Headless worker calls, scheduler
startup, speech, profile maintenance, and the optional authenticated companion
remain backend transports. Reused domain handlers are backend implementation,
not a second user interface. Bubble Tea remains an internal event-loop adapter;
its Go application views are empty and browser panels use typed snapshots.

Coding-agent adapters, including Codex/Claude Code/Pi, remain available to the
orchestrator. Removing the application's own CLI does not remove delegated coding
agents, execution tools, connectors, memories, retained evidence, or schedules.

`make check` runs Go tests/vet, browser gateway/rendering tests, shared-host tests,
and OAuth build validation. The terminal frontend's rendering and installation
checks have been removed with the product they verified. Historical audits retain
their observations; `docs/TERMINAL.md` and `docs/CLI-TUI-PORT.md` are archived.
