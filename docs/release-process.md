# Release process

This process prepares a versioned release; it does not authorize publishing.

1. Confirm all release criteria in `TODO.md`, including native CI and security
   fixtures. Do not release while a critical data-safety or credential issue is
   known.
2. Update the workspace package version. The internal dependency declaration is
   inherited from the workspace, so it stays aligned.
3. Run formatting, build, full tests, clippy with warnings denied, both audits,
   and native platform validation. Record checks that could not run.
4. Package `wukong-core`; publish it before attempting to publish the matching
   `wukong-cli` crates.io package. Verify both package tarballs before upload.
5. On each native release platform, run `scripts/package-release.sh <version>
   <target> <release-directory>`. Collect assets, run
   `scripts/write-release-checksums.sh`, and compare every checksum.
6. Obtain the exact immutable tag-source SHA-256 and render Homebrew/Scoop
   manifests with `scripts/render-install-manifests.sh`.
7. Create the exact `v<version>` tag and GitHub release, then upload only the
   generated ZIP files, their checksums, `SHA256SUMS`, and reviewed release
   notes. Publish any tap, bucket, or crates only with the appropriate account
   authority.
8. Reinstall each release artifact in a clean environment and run
   `wukong --version` plus the documented quick-start smoke test. Record
   result, platform, and limitations.

The current GitHub Actions billing/spending-limit blocker prevents the CI gate
from satisfying step 1. See [TODO wukong-002](../TODO.md) and
[release artifact ADR](adr/0037-release-artifact-layout.md).
