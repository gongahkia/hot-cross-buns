# Source adapters

Source adapters isolate protocol-specific request fields from generic package
resolution. Each adapter supplies canonical identity, optional version
discovery, immutable resolution, fetching, integrity metadata, layout metadata,
and offline availability through a typed core contract.

Only canonical source identity and immutable resolution identifiers cross into
shared resolution. A source without a version catalogue reports version
discovery as unsupported rather than inventing versions. The local-path adapter
is the first implementation. Git source locations and revision selectors now
canonicalise without network I/O; fetching, immutable commit resolution, and
the complete Git adapter remain W024 work. HTTP remains unimplemented. See
[ADR 0005](adr/0005-source-adapter-contract.md) and
[ADR 0020](adr/0020-git-source-canonicalisation.md).
