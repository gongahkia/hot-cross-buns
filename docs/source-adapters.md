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
checkouts; direct locking records its canonical URL and exact resolved commit.
The HTTP archive core fetcher accepts only credential-free HTTPS URLs and an
explicit lowercase SHA-256, then publishes verified immutable downloads and
direct locking records the verified archive source. Resolution and fetching
accept a source-neutral cancellation token;
adapters clean any adapter-owned staging state before returning cancellation.

Git version discovery is available through its Git-specific core boundary: it
returns sorted SemVer versions mapped to complete commits and accepts an exact
tag-prefix configuration. Local paths and checksummed HTTP archives report no
version catalogue, so they require an immutable source declaration or package
metadata rather than a version-only declaration. Catalog Git and HTTP adapters
provide the reviewed candidates used by the generic resolver.
See
[ADR 0005](adr/0005-source-adapter-contract.md) and
[ADR 0020](adr/0020-git-source-canonicalisation.md), plus
[ADR 0021](adr/0021-system-git-fetching.md) and
[ADR 0022](adr/0022-http-archive-transport.md), plus
[ADR 0023](adr/0023-source-adapter-cancellation.md) and
[ADR 0024](adr/0024-lockfile-schema-two-remote-sources.md), plus
[ADR 0026](adr/0026-git-version-discovery.md).
