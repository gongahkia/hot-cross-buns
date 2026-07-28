# Source adapter contributor guide

Read [source adapters](source-adapters.md), the current relevant ADRs, and the
contract test before changing source acquisition. Generic resolution must see
only canonical identity, immutable resolution, version availability, integrity,
layout metadata, and offline availability; it must not receive transport-only
fields such as HTTP headers or Git command details.

## Implementation sequence

1. Define an explicit source request and validate/canonicalise it without
   network access where possible.
2. Define an immutable lock identity before it can enter generic resolution.
3. Fetch into adapter-owned staging, verify integrity, then atomically publish
   a cache object under a scoped advisory lock.
4. Report unavailable offline content rather than falling back to network.
5. Prepare package trees and materialise only through the existing transaction
   boundary; never run package scripts.
6. Redact credentials in every diagnostic, persisted field, and cache key.

## Required coverage

Add unit tests for parsing, canonicalisation, identity, integrity, and error
mapping. Add temporary-filesystem integration tests for cold and warm cache,
offline miss/hit, interruption cleanup, concurrent acquisition, and sync
rollback. Implement the reusable `SourceAdapter` contract fixture in
`crates/wukong-core/tests/support/source_adapter_contract.rs` and add a security
fixture for every security-sensitive regression.

Create an ADR before changing source-adapter interfaces, source identity,
cache keys, Git strategy, or security policy.
