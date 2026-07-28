# Source adapters

Source adapters isolate protocol-specific request fields from generic package
resolution. Each adapter supplies canonical identity, optional version
discovery, immutable resolution, fetching, integrity metadata, layout metadata,
and offline availability through a typed core contract.

Only canonical source identity and immutable resolution identifiers cross into
shared resolution. A source without a version catalogue reports version
discovery as unsupported rather than inventing versions. The local-path adapter
is the first implementation. Git source locations canonicalise without network
I/O, and the core Git fetcher resolves immutable commits into verified cache
checkouts; connection to direct dependency locking remains later resolver work.
The HTTP archive core fetcher accepts only credential-free HTTPS URLs and an
explicit lowercase SHA-256, then publishes verified immutable downloads; its
connection to manifest and lockfile source declarations remains later resolver
work. Resolution and fetching accept a source-neutral cancellation token;
adapters clean any adapter-owned staging state before returning cancellation.
See
[ADR 0005](adr/0005-source-adapter-contract.md) and
[ADR 0020](adr/0020-git-source-canonicalisation.md), plus
[ADR 0021](adr/0021-system-git-fetching.md) and
[ADR 0022](adr/0022-http-archive-transport.md), plus
[ADR 0023](adr/0023-source-adapter-cancellation.md).
