# Canonical package trees

Wukong prepares the addon root selected by package-layout detection in a fresh
staging directory. Repository wrappers are therefore not copied. Within the
selected root, `.git`, `.hg`, and `.svn` administrative entries are excluded.

Prepared paths use Unicode NFC. Names that collide after Unicode
normalisation and case normalisation fail before staging is written. Symlinks,
special files, and non-UTF-8 names also fail. File permissions are normalised:
Unix output files are `0644` or `0755`; non-Unix output does not record an
executable bit.

The deterministic SHA-256 tree hash covers sorted paths, entry kinds,
executable bits, and file content. See [ADR 0010](adr/0010-canonical-package-trees.md).
