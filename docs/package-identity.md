# Package identity

A package name uses lowercase ASCII letters, digits, and internal hyphens. It
must start and end with an alphanumeric character. `wukong` rejects uppercase
and Unicode names instead of applying case-folding or Unicode normalisation.

The local-path vertical slice identifies a package by its name and an absolute,
filesystem-canonical local path. Equivalent existing paths, including resolved
symlinks, identify the same source. A package name cannot refer to two
different source identities in one resolution; the conflict is reported before
source work begins.

Development status is a dependency-edge property. It does not create a second
identity for the same package. Remote source identity variants are deferred to
their source adapters. See [ADR 0004](adr/0004-package-identity.md).
