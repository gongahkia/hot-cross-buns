# Godot support matrix

`config/godot-support.toml` is reviewed repository configuration, not project
state. It records the stable Godot 4 branches Wukong currently treats as
supported or partially supported; user commands never query the network to
read or validate it.

```toml
schema = 1

[[branch]]
series = "4.6"
support = "supported"
```

Each entry must use a unique, ascending `4.x` branch series. `support` is
either `supported` (bugs, security, and platform fixes) or `partial` (security
and platform fixes). Unknown fields, patch-shaped series, duplicates, empty
matrices, and unsupported statuses fail validation before the matrix is used.

Updates are ordinary reviewed source changes. They must use the current Godot
release policy and do not rewrite `wukong.toml`, lockfiles, or installed project
state.
