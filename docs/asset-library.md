# Official AssetLib adapter

The official adapter is opt-in because the upstream AssetLib backend is in maintenance mode. Build the CLI from this repository with:

```sh
cargo +1.85.0 run -p wukong-cli --features asset-library -- lock
```

Declare an addon by its positive decimal AssetLib ID:

```toml
[dependencies]
example-addon = { asset = "42" }
```

At lock time Wukong retrieves read-only asset metadata, requires `type = addon`, and stages the downloadable HTTPS ZIP. If upstream supplies a valid SHA-256, Wukong verifies it. If it is empty, as on the official service, Wukong computes the SHA-256 while staging and publishes only the verified artifact. The lockfile stores the existing generic HTTPS source identity, URL, and checksum; it does not store AssetLib-specific source types or metadata.

`wukong sync --locked` and offline sync use the locked archive only and do not contact AssetLib. Metadata is retained only for the active lock operation; verified artifacts use the normal checksum-addressed cache. The client sends no credentials and does not call AssetLib write or authentication endpoints.

An unavailable ID, non-addon asset, missing download URL, unsafe URL, malformed metadata, or unverified artifact stops before lockfile publication. See [AssetLib research](asset-library-research.md) and [ADR 0034](adr/0034-official-asset-library-boundary.md).
