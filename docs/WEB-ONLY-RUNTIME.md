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

## Local runtime controls

**Models → Local models** owns an optional, separately started Ollama process.
Status and review do not start inference. Start reviews the installed executable
and its SHA-256 before launching `serve`; it does not run an installer. Model
files go into a private cache scoped to the current profile, outside profile
backups. The child uses explicit `OLLAMA_HOST`, `OLLAMA_MODELS` and
`OLLAMA_NO_CLOUD=1`, with a small environment allowlist. These settings follow the
[official Ollama configuration documentation](https://docs.ollama.com/faq).

A private Go controller holds an exclusive per-profile owner lease and a shared
profile guard while active. Its loopback TLS endpoint uses a private certificate
binding and a host-injected token. Those credentials never reach browser
snapshots or model settings. The controller checks the launched executable and
listener owner before sending upstream HTTP requests. It does not adopt an
existing process or stop a PID recovered from disk. The proxy forwards finite
metadata routes and curated inference requests; runtime/model mutations through
that proxy are refused. Its active-request count blocks Stop and Download, with
another check after confirmation. Cooperating requests from other Go backend
processes use the same pinned endpoint and controller.

Start, Stop and Download require separate, expiring, single-use reviews bound to
the controller generation. An operation intent is written before admission;
latest status and a bounded archive of 32 operation records retain outcomes.
Interrupted operations are shown as uncertain and never replayed automatically.
Downloads recheck catalog identity, host eligibility and installed inventory;
only missing tags are admitted. Downloads do not select or run a model. The
existing installed-digest review and settings compare-and-swap publish a model
for future requests separately. Replacement, deletion, update, unload, external
runtime control, and automatic installation remain unavailable.

The app-owned process stays available after a browser or host disconnect so
background tasks can use it. Stop ends only the process handle created by this
controller; pending/scheduled local work then needs an explicit Start. Once
stopped, the idle controller releases its profile guard. A child that outlives
its controller is an attention state requiring inspection, never an adoptable
process. Same-user software that directly reaches the child's private loopback
port is outside the cooperating-request protocol; this is not OS sandboxing.

Linux process/listener ownership, lifecycle, proxy, cancellation and concurrent
request checks are covered by inert-process integration tests. macOS uses lsof;
Windows uses process and TCP ownership inspection. Cross-builds do not establish
native behavior on those platforms. Real Ollama downloads, GPU/model execution,
and macOS/Windows lifecycle behavior require separate native validation.
