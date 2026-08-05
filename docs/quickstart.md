# 60-second quick start

From a Godot 4 project directory containing `project.godot`, create a manifest:

```sh
wukong init
```

Add a local addon declaration to `wukong.toml`:

```toml
[dev-dependencies]
example-addon = { path = "../example-addon" }
```

Lock the exact local content and synchronise it into the project:

```sh
wukong lock
wukong sync --dev
```

Wukong writes `wukong.lock`, materialises the addon at its selected target, and
records ownership in `.wukong/state.toml`. Repeat `wukong sync` to verify the
no-op path. It never executes addon package scripts.

For a pinned Git or HTTPS archive declaration, see the [Git guide](git-fetching.md)
and [HTTP guide](http-archives.md). Use `wukong sync --frozen` in automation
after the required immutable sources are cached.
