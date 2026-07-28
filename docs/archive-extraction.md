# Archive extraction

`wukong` currently accepts ZIP archives only. Every entry is preflighted before
the staging tree is created: traversal, absolute and Windows-prefixed paths,
symlinks, special files, duplicates, excessive file counts, expanded size, and
expansion ratios are rejected.

Extraction writes only to a new caller-owned staging root. Any extraction
failure removes that root; no project files are changed. ZIP symlinks and
hardlinks are unsupported. TAR formats remain deferred. See
[ADR 0007](adr/0007-zip-extraction-security.md).
