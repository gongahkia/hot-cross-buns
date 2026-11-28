# Trusted MCP servers

**Interface status:** Hot Cross Buns runs as a local browser app (`make run`). Shell examples below are source-checkout developer operations with an explicit internal opt-in; see [development instructions](DEVELOPMENT.md). They do not install or enable a public CLI.

Hot Cross Buns exposes trusted Model Context Protocol (MCP) tools from a repository
configuration at `.hot-cross-buns/mcp.json`. The configuration is inert until the
developer reviews and explicitly pins it:

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns mcp status
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns mcp trust
```

`hot-cross-buns mcp status` shows the hash trust state and, for each configured remote
server, only `authenticated`, `not authenticated`, or `expired`. It never
prints an endpoint's access token, refresh token, or public client metadata.

Trust records use the canonical repository path. Their hash covers the
manifest and a streaming SHA-256 digest of each repository-local stdio
executable (up to 128 MiB per executable). Editing a bundle disables it until
it is trusted again. Every MCP tool call still passes the existing allow-once,
allow-this-exact-tool, or deny policy. A remembered exact-tool permission may
satisfy later calls under that policy; this is not a promise of a new prompt or
payload-specific approval for every project-tool call. Mapped connector mutations
retain their separate exact-action approval and receipt path.

```json
{
  "version": 1,
  "servers": [
    {
      "name": "github",
      "transport": "streamable_http",
      "url": "https://mcp.example.com/mcp"
    },
    {
      "name": "repository-tools",
      "transport": "stdio",
      "command": [".hot-cross-buns/mcp/repository-tools"],
      "network": "deny"
    }
  ]
}
```

Names use lower-case letters, digits, underscores, and hyphens. Stdio commands
are an argv array whose executable is a regular executable inside the repository,
or an explicitly reviewed final interpreter symlink with a canonical runtime path
and SHA-256 pin; Hot Cross Buns never resolves it through `PATH` or a shell. HTTP servers
must use HTTPS unless they are a loopback development server. The client supports the tools subset of MCP `2025-11-25` and `2026-07-28`
over stdio or Streamable HTTP. It first performs bounded, read-only modern
`server/discover` setup, then uses a verified compatible modern response or a
legacy `initialize` handshake and `notifications/initialized`. Unsupported
versions fail before tools become available. Negotiation never repeats a tool
mutation. See [MCP transport hardening](MCP-HARDENING.md) for exact bounds,
compatibility, failure handling and verification.

Stdio servers that attach to an existing local service can declare
`"runtime_directories": ["/tmp/sagasu-1000"]` in their server configuration.
These are exact read/write sandbox mounts, not access to all of `/tmp` or the
user's home. Each directory must already exist, be canonical without symlinks,
and have private owner-only permissions. The field is part of the reviewed
manifest hash: adding or changing a directory invalidates existing trust and
requires review through MCP setup. Socket and lock contents remain volatile;
Hot Cross Buns does not remove them or restart the shared host. Without an
explicit mount, a sandboxed server may be unable to see its existing host.

## Remote OAuth

If a Streamable HTTP server returns `401 Unauthorized`, authenticate the
trusted server explicitly:

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns mcp login github
# If the authorization server requires an existing public client:
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns mcp login --client-id YOUR_PUBLIC_CLIENT_ID --redirect-url http://127.0.0.1:3000/callback github
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns mcp logout github
```

Hot Cross Buns follows the MCP HTTP authorization flow: it discovers protected-resource
metadata from the `WWW-Authenticate` challenge or the required well-known
paths, discovers OAuth or OpenID Connect authorization-server metadata,
requires advertised PKCE `S256`, and includes the canonical MCP resource in
both authorization-code and token requests. It uses the challenge scope when
present; otherwise it requests the resource metadata's advertised scopes.

For a client unknown to the authorization server, Hot Cross Buns uses OAuth Dynamic
Client Registration as a public client and registers the exact ephemeral
`127.0.0.1` callback URL before it opens the browser. It registers a fresh
client for each such login, because the redirect URI must match exactly. If
dynamic registration is unavailable, register a public client with the service and provide its ID
and exact registered loopback URI using `--client-id` and `--redirect-url`.
Hot Cross Buns cannot use Client ID Metadata Documents because it
does not host a stable public HTTPS metadata document; it reports that
constraint instead of claiming an identity it does not own.

The access and refresh token live only in Hot Cross Buns's private `0600` credential
store. The store key is a hash of the canonical MCP resource; accompanying
metadata must match that exact resource, token endpoint, and public client ID
before Hot Cross Buns attaches or refreshes the token. Tokens are sent only in the
`Authorization: Bearer` header, never in a URL or project file. A project MCP
configuration never contains a client secret, access token, refresh token, or
credential source. Stdio MCP servers do not use this flow; give them required
credentials through the sandbox's explicit environment policy instead.

OAuth remains an external authorization grant. Hot Cross Buns can test protocol flow
locally, but cannot verify a third-party authorization server's account,
scope, consent page, or data handling.

## Discovery, streaming and cancellation

Tool discovery follows opaque cursors with bounds of 32 pages, 256 tools total
across a project configuration and 1 MiB per server catalog. Duplicate tools,
colliding public aliases, repeated/oversized cursors and incomplete discovery
fail explicitly; a partial tool set is not silently enabled. Native tool names
may use ASCII letters, digits, underscores, hyphens and dots (up to 128 bytes).
Hot Cross Buns's model-facing names remain bounded safe aliases; original names are used
on the wire. These rules do not widen connector or server identity syntax.

HTTP streams are parsed incrementally through comments, notifications and
multiline SSE data until the matching response arrives. Capturing a result does
not wait for server EOF. Messages and requests are bounded to 128 KiB; tool
results retain the existing 64 KiB limit. Streams consume at most 1 MiB and 256
nonempty events. A request and its queue wait have a two-minute deadline or the
caller's shorter deadline; setup discovery has a two-second probe deadline.

Both transports have cancellable request gates. Cancelling a stdio operation
attempts a bounded cancellation notification and closes its owned subprocess;
stalled writes and ignored EOF cannot indefinitely block the owner. Closing
stdin starts shutdown, followed by forced termination after 250 ms and a bounded
250 ms reap wait. If exit cannot be observed, cleanup is deferred until exit and
an explicit error is returned. Only read-only discovery may time out and fall
back to legacy setup in the same process; late replies cannot match a new ID.
HTTP cancellation closes its request stream. Neither transport automatically
restarts or replays tool calls after failure.

The newer stateless path sends per-request version/capability metadata and the
required method/tool headers, without legacy session headers. Supported primitive
`x-mcp-header` mappings are validated and encoded from the exact transmitted
arguments; malformed, conflicting or unsupported annotations fail catalog
admission. Derived headers are bounded to 16 KiB. Redirects are refused and
server-authored RPC error text is excluded from ordinary diagnostics.

This is a tools client, not an implementation of every MCP capability. Additional
interaction (`input_required`), server-initiated sampling/elicitation, resources,
prompts, subscriptions, tasks and stream resumption are not implemented. Such
interactions do not gain approval or trigger automatic retry. Existing OAuth
setup is retained; broad vendor compatibility and complete modern OAuth
conformance are not certified by local fixture tests. A timeout or disconnect
after dispatch can leave the remote outcome unknown. Approval and transport
acknowledgement do not prove an external action completed.

## Guided setup and remote hosts

Ask HCB in chat to help configure a server. For a profile-wide remote connection,
use **Settings → Connections → Custom MCP server** or let HCB prepare a reviewed
`connection_setup` change. Enter the exact Streamable HTTP endpoint and exact
search/read/action tool names. At least one read/search mapping is required.
Authentication can be none, a privately entered bearer token, or your OAuth app's
public endpoints/client ID/scopes and registered loopback callback. “Check account
& read access” discovers tool names and schemas and validates mappings without
calling a mapped tool. Discovery is bounded and may contact the endpoint; it does
not prove each mapped operation will succeed with real arguments.

For local stdio servers, select a Git project and ask HCB to inspect MCP setup.
For requested setup, HCB inspects the project directly and prepares one **Connect
MCP server** review. Acceptance saves `.hot-cross-buns/mcp.json`, trusts the exact
bundle, starts only the selected server and discovers its tools. No business tool
is called. The result distinguishes a verified connection from configuration saved
with a concrete startup failure. No `/source` switch or follow-up “continue” is
needed. An installed Python virtual-environment interpreter may be a symlink: setup
resolves and pins its canonical target and bytes. Changing executable/runtime bytes
invalidates the reviewed bundle. Missing installs and private authentication remain
separate operations; the setup action does not invent or install dependencies.
Advanced `set` and `trust` actions remain available for separate configuration and
trust changes. Credentials
must not appear in the manifest, command arguments or endpoint query strings.
Project stdio integrations remain available through the code integration workflow;
adding configuration does not enable a current run or bypass tool approvals.

A Raspberry Pi can run HCB as an **outbound MCP client**. No inbound HCB MCP service
or public port is required. Use the remote server's HTTPS endpoint and a valid
certificate trusted by the Pi. LAN HTTP URLs are rejected. For an HTTP-only LAN
server, forward it to the Pi's loopback interface, for example:

```sh
ssh -N -L 127.0.0.1:8000:127.0.0.1:8000 user@mcp-host
```

Configure `http://127.0.0.1:8000/mcp` on the Pi. Here localhost means the Pi,
not the device displaying HCB. Keep the tunnel alive while using the connection.
For browser access to HCB itself, forward its loopback port from your laptop:

```sh
ssh -N -L 4317:127.0.0.1:4317 user@raspberrypi
```

Then open `http://127.0.0.1:4317` on the laptop. For OAuth sign-in whose registered
callback listens on the Pi at port 3000, also forward laptop port 3000 to Pi
loopback port 3000. Microsoft device sign-in needs no callback tunnel. Repository
MCP OAuth discovery/login is also available through the internal commands above;
profile connection OAuth uses the explicitly configured app endpoints.

Build prerequisites on a 64-bit Pi remain Go and Node as listed in DEVELOPMENT.md.
An ARM64 cross-build verifies compilation only; it does not test Pi hardware,
local stdio executables, memory use or access to a real remote service.

The conversational `mcp_setup` update accepts `repository` directly. Inspect topic
`mcp` with `query` equal to that directory first, then use action `connect` with
the returned `expected_digest` and exact public `server` command/URL. Existing
servers are preserved; replacing a named entry is shown in the full bundle review.
Commands, manifests, trust and executable/runtime hashes are checked again before
publication and discovery. Project MCP tools are available to foreground chat through hot_cross_buns_mcp,
and to code work through its existing integration and tool permission checks.

## Foreground chat invocation

Normal foreground chat exposes `hot_cross_buns_mcp` for trusted project servers.
Use `discover` to read names, input schemas and server-supplied annotations, then
`call` with an exact server/tool and JSON arguments. Local stdio and Streamable
HTTP both use the same control. The host retains one session per project/server
for the run, allowing asynchronous operations to be polled without restarting the
server. Sessions close at run completion. This surface is not exposed to scheduled
or other unattended runs.

Discovery requires the exact current trusted bundle. Every call rechecks trust
and executable/runtime hashes after its approval. A tool declaring `readOnlyHint`
requires a foreground review of its exact arguments; the hint is shown as a
server declaration, not proof of effect or permission. Undeclared and mutating
tools use the task's external-action policy: inspect forbids them, draft retains
a proposal, and act requires fresh approval plus a durable execution receipt.
Uncertain actions are not replayed. Ordinary live reads use MCP directly rather
than a coding agent or a local database cache.

For setup/startup/configuration failures the tool reports configured local CLI
roles and the existing `filesystem request_access` → `start_agent` → `await_agent`
repair path. Diagnosis can use the current read scope. Repairs retain the
configured worker's edit ceiling, live filesystem approval and any required
reviewed patch/application workflow. HCB does not install or substitute an
unconfigured CLI. Actual service access and private login still require that
service's setup; a connected catalog is not evidence that a live read succeeded.

## Remembering foreground MCP approval

Chat MCP reviews offer Decline, Allow once, and Always allow this MCP. The saved
grant covers all reads and actions from that exact server, project and trusted
bundle. Adding tools to the same server falls within that grant; changing the
manifest or pinned executable invalidates it. This does not grant access to
other servers, projects, arbitrary commands, or scheduled runs. Inspect/draft
mode restrictions and durable action receipts still apply. Unknown action
outcomes are not automatically replayed.

Revoke a saved grant in Settings → Permissions → MCP servers. Revocation
invalidates pending reviews; an already admitted call may finish. The grant
is saved only after the user chooses Always allow, never from model text.
