# Git fetching

The core Git fetcher invokes the `git` executable from `PATH` with argument
vectors only. It does not invoke a shell, provide credentials, override SSH,
or initialise submodules; system Git, SSH, and credential-manager configuration
remain in control of authentication.

Each fetch resolves `HEAD`, a tag, a branch, or a complete revision to a full
commit. A clean detached checkout is staged below the cache, verified against
that commit, and atomically published under a SHA-256 key derived from the
canonical source identity and commit. Selector metadata stores only the commit.
Paths and metadata contain no source URLs or credentials.

An advisory source lock serialises concurrent fetches. A retry removes only
staging directories with its own source-derived prefix, recovering from an
interrupted fetch without touching another source. Offline fetching accepts only
a verified cached selector mapping and checkout. See
[ADR 0021](adr/0021-system-git-fetching.md). `wukong lock` records the
canonical URL and resolved complete commit in schema-two locks; project
materialisation of Git sources remains later work.

## Version tags

The core Git fetcher can discover version tags with an optional exact
`GitTagPrefix` such as `v`. It stages a bare tag fetch, parses only matching
SemVer tags, and peels every selected tag to a complete commit. Build metadata
does not distinguish selectable versions; tags for the same version must map to
the same commit.

Version metadata records only sorted `version -> commit` mappings under a
source/prefix digest. Online discovery refreshes it; offline discovery requires
the cached mapping to parse and validate. Local paths and checksummed HTTP
archives have no version catalogue. See [ADR 0026](adr/0026-git-version-discovery.md).
