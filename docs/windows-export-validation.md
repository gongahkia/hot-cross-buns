# Windows export validation

`.github/workflows/windows-export.yml` runs on `windows-2022` for pushes, pull requests, and manual dispatch. It downloads Godot `4.7.1-stable` and its matching Windows export template, imports project resources verbosely, runs `windows_long_run_stability_test.gd`, exports the `Windows Desktop` preset, requires an `.exe` and matching `.pck`, verifies the executable `MZ` header, archives both files, and uploads `a-slow-walk-windows.zip`.

The workflow saves the absolute downloaded Godot console executable path in the runner temporary directory and invokes that exact executable in every later step. The Windows archive also contains a GUI executable, but the console host is required so PowerShell receives the completed Godot process’s real exit status. It does not rely on a PATH mutation between PowerShell steps.

Godot’s `.godot/` directory is local editor/import state and is excluded from source control. This is required for a portable clean import: cached editor metadata can contain platform-local build paths and cannot be reused across macOS and Windows runners. Script `.uid` files remain source metadata and are tracked.

## Verification

```sh
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/windows-export.yml")'
```

The executable workflow runs on GitHub-hosted Windows, not this macOS workspace. Its artifact checks and Windows-only soak are the focused validation; a successful workflow must still be inspected in GitHub Actions.

## Dependencies

- GitHub Actions `windows-2022`, `actions/checkout`, `actions/upload-artifact`, 7-Zip, network access to pinned Godot releases, and matching export templates.
- The `Windows Desktop` export preset and `windows_long_run_stability_test.gd`.

## Performance

The job runs only in CI. Godot/template download, import, headless soak, export, archive creation, and artifact upload consume runner time; no game runtime frame path changes.

## Out of scope

Windows code signing, SmartScreen/reputation, installer creation, release-page upload, GPU/driver certification, interactive player QA, antivirus compatibility, and proving the artifact runs on every Windows device.
