# Package metadata

`wukong-package.toml` is optional. A package without it remains directly
installable using its project declaration and inferred layout; an absent file
is treated as no package metadata.

When present, schema one requires:

```toml
[package]
schema = 1
name = "example-addon"
version = "1.2.3"
godot = ">=4.4,<5"
root = "addons/example-addon"
target = "addons/example-addon"

[dependencies]
other-addon = "^2"
```

`root` and `target` must be safe relative paths. Dependencies use canonical
names and the [versioning policy](versioning.md). Metadata cannot declare sources or
scripts. See [ADR 0009](adr/0009-package-metadata-schema.md).
