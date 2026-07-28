# HTTP archives

The HTTP archive fetcher accepts a credential-free HTTPS URL and an explicit
lowercase SHA-256 checksum. `wukong lock` records verified direct HTTP archives
in schema-two locks; `wukong sync` verifies, extracts, prepares, and
transactionally materialises locked direct HTTP sources.

Downloads use Rustls certificate validation and follow at most five redirects.
Every initial URL and redirect target must be HTTPS, have a host, and contain
no credentials, sensitive query parameters, or fragments. Non-success
responses and bodies above 256 MiB are rejected.

Bytes stream to a unique temporary directory below `downloads/sha256/`.
Wukong hashes the stream before atomically publishing it as
`downloads/sha256/<checksum>`. An active checksum lock fails fast with a retry
diagnostic; its persistent lock file is safe because the operating system
releases held advisory state on process exit. Failed or interrupted downloads
publish no cache entry; abandoned staging directories for that checksum are
removed while holding its process lock. A warm-cache read re-hashes the file
before reuse. See [ADR 0030](adr/0030-advisory-operation-locks.md).

The archive fetcher neither executes package scripts nor persists source URLs,
redirect destinations, timestamps, or credentials. Conditional requests are
deferred because entries are immutable and checksum-addressed. See
[ADR 0022](adr/0022-http-archive-transport.md).

## Dependency guide

Obtain the checksum from a trusted release channel before adding the source:

```toml
[dependencies]
example = { url = "https://example.test/example.zip", sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }
```

Run `wukong lock` to cache and record the immutable artifact, then `wukong sync`
to install it. `--offline` accepts only the verified checksum-addressed cache
entry and opens no network connection on a miss.
