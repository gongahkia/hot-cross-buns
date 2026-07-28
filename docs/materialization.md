# Materialisation

`wukong-core` supports per-file `auto`, `copy`, `hardlink`, and `reflink`
preferences. Auto probes the actual staging filesystem in this order: reflink,
copy. It never uses hardlinks because project edits must not mutate a local
source or cache object. Explicit preferences are test controls and fail if
unavailable; they do not silently degrade. No symlinks are used.

The installed state records the strategy selected for every file. Reflinks are
attempted on macOS and Linux only; Windows auto mode uses copies. See
[ADR 0019](adr/0019-materialisation-strategies.md).
