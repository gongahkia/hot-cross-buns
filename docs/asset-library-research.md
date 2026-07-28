# Official Asset Library research

Research date: 2026-07-29.

## Public boundary

The maintained AssetLib source documents the editor-compatible read API as
`GET /configure`, `GET /asset`, and `GET /asset/{id}`. `asset_id` is the
stable lookup identifier. Asset details include the displayed version,
`download_commit`, `download_url`, `browse_url`, license (`cost`), and an
optional `download_hash`. See the [AssetLib API](https://raw.githubusercontent.com/godotengine/godot-asset-library/master/API.md).

`GET /asset/{id}` is the only required lookup for an ID declared by Wukong.
Search is optional UI functionality and must not participate in locking or
installation. The AssetLib distinguishes addons from standalone projects;
only `type = addon` is eligible for addon installation. The official
[AssetLib documentation](https://docs.godotengine.org/en/stable/community/asset_library/what_is_assetlib.html)
confirms that distinction.

## Authentication and rate limits

The read endpoints above require no token in the published API. Wukong will
not call login or write endpoints, accept credentials, or persist response
authentication fields.

[Unverified] The published API reference contains no rate-limit policy. A
future adapter must use bounded, serial metadata requests, respect explicit
server retry guidance when supplied, and avoid persistent freshness caching
until the upstream publishes a stable policy.

## Reproducibility and integrity

The API reports an asset ID and version fields, but the official service leaves
`download_hash` empty. Its own API reference says the download URL is generated
from `download_commit` and `browse_url`. Therefore neither metadata response is
an immutable install identity by itself.

At lock time, a future adapter must fetch the selected artifact once, compute
its SHA-256 while staging it, verify the staged bytes, and persist the generic
checksum-addressed HTTP artifact identity. Locked install and offline install
must use that persisted artifact identity without re-querying AssetLib. A
re-lock may query the same `asset_id` again and create a new immutable artifact
identity if upstream metadata changed.

## Licences and redistribution

The AssetLib `cost` field represents the asset licence, not price. Official
[submission guidance](https://docs.godotengine.org/en/stable/community/asset_library/submitting_to_assetlib.html)
requires the declared licence to match a licence file in the source repository.
Wukong must display the reported licence as unverified upstream metadata and
must not claim licence validation.

Wukong downloads an artifact into the user cache and materialises it into that
user's project. It must not host, mirror, publish, or redistribute AssetLib
artifacts. Package authors' licence obligations remain applicable to users and
to any later distribution of their projects.

## Upstream risk

The [AssetLib backend repository](https://github.com/godotengine/godot-asset-library)
states that it is in maintenance mode and is planned for deprecation by a
future Godot Foundation asset store. The official adapter is consequently an
opt-in feature, isolated from generic resolution and lockfile types. See
[ADR 0034](adr/0034-official-asset-library-boundary.md).
