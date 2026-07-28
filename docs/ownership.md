# Ownership maps

Before synchronising, Wukong combines canonical package trees into a sorted
map of project-relative files. Each entry has a SHA-256, executable bit, source
path, and owner set. Exact identical files may be shared; differing files at
one path, case-folded portable-path collisions, and files already owned by the
project stop synchronisation before mutation. See [ADR 0017](adr/0017-ownership-maps.md).
