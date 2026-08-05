# itch.io build, upload, and release checklist

This is a manual release gate for the current Godot 4 project. It does not publish, sign, notarize, or upload anything by itself. The configured targets are macOS (`dist/a-slow-walk.app`) and Windows Desktop (`dist/a-slow-walk.exe` plus any generated companion files); Linux, web, mobile, and console builds are not configured.

## 1. Freeze the release candidate

- [ ] Start from a clean, reviewed commit and record its SHA.
- [ ] Choose one release version. Update macOS `application/short_version` and `application/version`, and Windows `application/file_version`/`application/product_version`, in `export_presets.cfg` together. The current preset baseline is `0.1.0` / `0.1.0.0`.
- [ ] Review preset identity: macOS bundle ID is `org.aslowwalk.game`; current signing/copyright fields and Windows icon fields are empty. Supply/review them deliberately before a public release rather than assuming they are configured.
- [ ] Confirm `THIRD_PARTY_NOTICES.md` remains included and that `levels/_drafts/`, `tools/`, MCP config, tests, `.godot/`, and `dist/` are excluded from exports as intended.
- [ ] Record Godot version, host OS/architecture, renderer, target version, and release notes.

## 2. Validate and build

- [ ] Run static and headless checks:

  ```sh
  git diff --check
  /Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
  for task_test in scripts/*_test.gd; do
    /Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script "res://${task_test}" || exit $?
  done
  /Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/level_cli.gd -- --validation-fixtures
  uv --directory tools/level_mcp run --group test python -m pytest
  ```

- [ ] Confirm the installed Godot version has matching export templates, then build both configured presets:

  ```sh
  ./script/export_release.sh
  ```

- [ ] Inspect the produced macOS `.app` and every Windows companion file. Do not treat a successful export command as a platform launch test.
- [ ] Stage one exact portable build directory per platform. Keep the macOS `.app` intact; stage the Windows executable with all files generated beside it. Do not push the mixed `dist/` parent directory or a lone `.exe`.
- [ ] Launch/test staged builds on their target platforms: cold launch, controls, procedural expedition, save/recovery, survival resolution, photo capture, export, and clean exit. Run the Windows stability path on Windows. If macOS distribution needs signing/notarization, complete that separate workflow and record the result.
- [ ] Confirm the [Windows export validation workflow](windows-export-validation.md) passed for the release commit; it validates the artifact and headless soak, not interactive player QA.

## 3. Prepare the itch.io project page

- [ ] Create the itch.io project page first; `butler` uploads builds to an existing `user/game` target and does not create the page.
- [ ] Set title, short description, classification, pricing/access state, contact/support information, and accurate platform claims. Add a cover image with itch.io’s recommended 315:250 aspect ratio and representative screenshots.
- [ ] Use a draft/restricted/hidden review plan appropriate to the intended audience. Verify the final access setting in the page UI before announcing it.
- [ ] Create platform channels named with clear platform tokens: `macos` and `windows` are the defaults in the commands below. Confirm itch.io’s detected platform tags and save page changes.

## 4. Preview and upload with butler

Install/authenticate `butler` only on the release machine. This workspace currently has no `butler` executable and no itch.io target/credentials configured.

```sh
butler version
butler login

export ITCH_TARGET='user/game-slug'
export RELEASE_VERSION='0.1.0'
export MAC_BUILD='path/to/staged/macos/a-slow-walk.app'
export WINDOWS_BUILD='path/to/staged/windows'

butler push-preview --changes-only "$MAC_BUILD" "$ITCH_TARGET:macos"
butler push-preview --changes-only "$WINDOWS_BUILD" "$ITCH_TARGET:windows"
butler push --userversion "$RELEASE_VERSION" "$MAC_BUILD" "$ITCH_TARGET:macos"
butler push --userversion "$RELEASE_VERSION" "$WINDOWS_BUILD" "$ITCH_TARGET:windows"
```

- [ ] Review both `push-preview` file diffs before the matching `push`.
- [ ] Verify `ITCH_TARGET` is the actual lowercase account/page slug and version labels match the exported preset/version notes.
- [ ] For a first review-only channel, `butler push --hidden` is available; it applies only when that channel is first created. Unhide/reconfigure it from the itch.io Edit page after review.
- [ ] Never add API keys, credentials, account names, or page URLs to this repository or release notes unless intentionally public.

## 5. Post-upload release gate

- [ ] On the itch.io Edit page, verify each upload is attached to the intended platform and channel, then save the page.
- [ ] Download/install each channel from a fresh player-facing path and repeat the target-platform smoke flow.
- [ ] Confirm title, description, screenshots, version, pricing/access state, legal notices, and known limitations accurately describe the shipped build.
- [ ] Retain the staged artifacts, checksum/evidence if used, test outputs, commit SHA, Godot version, and release notes for rollback investigation.
- [ ] Announce only after the platform/download checks pass. Keep prior published artifacts until a replacement has been independently verified.

Official references: [itch.io creator setup](https://itch.io/docs/creators/getting-started), [butler installation/login](https://itch.io/docs/butler/installing.html), [butler push, channels, versions, previews, and hidden first channels](https://itch.io/docs/butler/pushing.html), and [butler troubleshooting](https://itch.io/docs/butler/troubleshooting.html).

## Dependencies

- Current `export_presets.cfg`, `script/export_release.sh`, matching Godot export templates, platform test hardware, and `THIRD_PARTY_NOTICES.md`.
- An existing itch.io project page plus a release operator’s `butler` authentication; optional macOS signing/notarization tooling if that distribution path is required.

## Performance

The checklist adds no runtime work. Export, staging, hashing/preview, uploads, and target-device QA are release-time costs; `butler push-preview` hashes local build contents and can take comparable local work to an upload diff.

## Out of scope

Automated CI/CD publishing, credential provisioning, code signing/notarization implementation, store-page copy/art production, analytics, marketing, Linux/web/mobile/console release, platform certification, and a claim that the currently unsigned/unverified artifacts are release-ready.
