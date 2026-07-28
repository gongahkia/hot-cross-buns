# ADR 0026: Git version discovery

## Status

Accepted

## Context

Git repositories can expose package versions through tags, but tags may be
annotated, lightweight, non-SemVer, or duplicated at different commits. The
resolver needs a deterministic mapping from each selectable semantic version to
an immutable commit. Offline resolution also needs metadata that is safe to
read without storing source URLs, credentials, mutable tags, or timestamps.

## Decision

Use the system `git` executable to fetch `refs/tags/*` into a private staged
bare repository. Enumerate tags locally, strip an optional validated
`GitTagPrefix` exactly, parse the remainder as SemVer, and peel each selected
tag with `^{commit}`. Tags that do not parse as SemVer are ignored; a selected
tag that cannot peel to a complete commit is an error.

Build metadata is removed before catalog identity. Tags resolving to the same
canonical semantic version and different commits are rejected. Equivalent tags
at the same commit collapse to one sorted `version -> commit` entry.

Store only those sorted entries below
`metadata/git-versions/sha256/<digest(canonical-source, tag-prefix)>`, with a
fixed schema header and trailing newline. Source URL, tag names, credentials,
and timestamps are not persisted. The existing per-source Git cache lock
serializes metadata reads and writes. Online discovery refreshes the catalog;
offline discovery accepts only a fully parsed and validated catalog. Missing or
corrupt offline metadata fails rather than being guessed.

## Consequences

Git discovery has no custom network protocol and does not run package scripts.
It may transfer objects reachable from version tags, so future performance work
must measure it separately from selected-package fetches. The metadata cache is
recoverable: a failed replacement can leave it absent, which makes offline
discovery unavailable but cannot select an unverified version.

Local paths and checksummed HTTP archives report no version catalogue. They
remain exact source-pinned dependencies unless package metadata or a future
source adapter supplies version data. W063 consumes this catalog through its
source-neutral resolver provider.

## Alternatives considered

- Parse `git ls-remote` output alone: rejected because an annotated tag's first
  object ID is a tag object rather than necessarily a commit.
- Assume lightweight tags always name commits: rejected because Git refs can
  point at other object types.
- Persist raw tags or source URLs: rejected because neither is needed for
  offline version selection and URLs could expose credentials.
- Treat duplicate semantic tags as deterministic by tag name: rejected because
  a version would still identify conflicting immutable content.
