# Source adapters

Source adapters isolate protocol-specific request fields from generic package
resolution. Each adapter supplies canonical identity, optional version
discovery, immutable resolution, fetching, integrity metadata, layout metadata,
and offline availability through a typed core contract.

Only canonical source identity and immutable resolution identifiers cross into
shared resolution. A source without a version catalogue reports version
discovery as unsupported rather than inventing versions. The local-path adapter
is the first implementation; Git and HTTP adapters remain out of scope until
the local vertical slice is complete. See
[ADR 0005](adr/0005-source-adapter-contract.md).
