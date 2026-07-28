# Troubleshooting

Start with:

```sh
wukong doctor --project <project-directory>
```

`doctor` checks local inputs without contacting a source endpoint or executing
Godot. Diagnostics use stable categories: user input (exit 2), source access
(3), integrity (4), and internal failure (70).

| Symptom | Check | Recovery |
| --- | --- | --- |
| No project found | Run from a directory below `project.godot`, or pass `--project`. | See [project discovery](project-discovery.md). |
| Lock and manifest differ | Run `wukong lock`; in CI, correct the committed files instead. | Do not drop `--locked` to hide drift. |
| Offline cache miss | Run a trusted online lock/sync first. | Keep the exact immutable source and checksum. |
| File ownership conflict | Inspect the reported target path. | Move the project file or select a distinct package target; never force overwrite. |
| Former addon file was edited | Restore it or move the edit before removing/updating. | Wukong preserves it deliberately. |
| Git source unavailable | Check `git`, SSH, and credential-helper configuration outside Wukong. | Retry after an active same-source operation completes. |
| Archive rejected | Confirm HTTPS, no credentials, and the exact lowercase SHA-256. | Check [HTTP archives](http-archives.md). |
| Godot validation fails | Supply an explicit executable and bounded timeout. | Read [validation](validation.md); validation is opt-in. |

Use `--json` only with tools that support the versioned protocol. Before sharing
`--verbose` output, remove secrets and private project paths; see
[credentials](credentials.md).
