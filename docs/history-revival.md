# Hot Cross Buns history revival

`main` is an Electron-first Hot Cross Buns revival. It is intentionally a new
repository at `../hot-cross-buns`; the source Gator repository and its full
history are not changed by this work.

## Preserved lineages

| Lineage | Source range | Where to find it |
| --- | --- | --- |
| HCB 1 Swift | `988872bd34b3588b48d99dc2f0928f41877130d2` through `d5fc2a4830415202a2ae8fac4de95258a4d3ab3f` | `legacy/swift` |
| HCB 2 Electron | `3fefc0707ca807fa3863c9468146d0e10e1e370c` through `b9b92840098579f244154420fa12bd0628002a81` | `main` |

The Swift slice replays 628 commits that change the historical Apple source
tree. The Electron slice replays its eight original documentation/scaffold
commits, including `b9b928400` (`feat(app): scaffold electronapp`). Original
author information and commit messages are retained; replay necessarily gives
the commits new object IDs.

The source Electron history assumed an inherited empty `README.md` and
`.gitignore` from a parent project that was not Hot Cross Buns. Two explicit
foundation commits recreate only those preconditions. A merge commit makes the
Swift lineage reachable from `main` while retaining the Electron working tree.

## What was deliberately excluded

The source repository is a composite history containing unrelated projects and
later HCB implementations. Those commits are not copied here. In particular,
the later Python CLI/TUI is used as an evidence source for portable backend
behaviour; its source is not silently mixed into the Electron application.

## Inspecting the history

```sh
git log --first-parent --oneline main
git log --oneline legacy/swift
git log --graph --all --decorate
```
