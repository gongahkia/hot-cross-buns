# Hot Cross Buns

This is the revived Electron implementation of Hot Cross Buns. It retains the
HCB 1 Swift history on `legacy/swift` and uses the HCB 2 Electron codebase as
its active `main` tree.

The app currently provides a local-first task core: validated Electron IPC,
atomic local persistence, bounded task reads, optimistic mutations, durable
idempotency receipts, and an ordered outbox. It does not claim Google sync
until the OAuth and Google transport adapter are implemented.

Read [the history revival record](docs/history-revival.md) before rewriting
history, and [the TUI-core port ledger](docs/tui-optimisations-port.md) before
changing storage, transport, or renderer data flows.

## Development

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm exec electron-vite build
```

## Local Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test:unit
pnpm test:smoke
```

The current app scaffold is Electron + React + TypeScript + Vite with an unprivileged renderer and a narrow preload API.
