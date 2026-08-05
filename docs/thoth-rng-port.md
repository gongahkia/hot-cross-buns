# Thoth RNG primitive port

`scripts/world_rng.gd` exposes the ported primitives without changing the existing `hash_int`, `unit`, `signed`, `value_noise`, or `fbm` callers:

- `WorldRng.thoth_hash(seed, a, b, c, d)` returns the signed 32-bit Thoth hash.
- `WorldRng.unit_at(...)` maps that hash to `[0, 1)`.
- `WorldRng.thoth_signed(...)` maps it to `[-1, 1)`.
- `WorldRng.new(seed)`, `next()`, `next_unit()`, and `next_range(min, max)` provide the Thoth LCG stream.

`hash` cannot be the GDScript API name because it resolves to Godot's one-argument global `hash()` helper. The `thoth_` prefix makes the non-conflicting port explicit.

The hash deliberately reproduces LuaJIT BitOp's `2^52 + 2^51` number-to-int32 conversion before its 32-bit xor/shift finalizer. This preserves the historical Thoth stream for the checked LuaJIT fixtures, including operands whose products exceed a signed 32-bit range.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_rng_test.gd
```

The fixture checks LuaJIT-derived hash/unit vectors, a fixed LCG sequence, and inclusive range bounds.

## Dependencies

- Godot 4 `PackedByteArray.encode_double` and `decode_s32` for the LuaJIT-compatible BitOp conversion.
- Godot's 64-bit `int` arithmetic for the LCG state and inclusive range modulo.

## Performance impact

The compatibility hash performs five small byte-buffer conversions per call. Keep it for stable Thoth descriptor streams and fixture compatibility; use the existing `hash_int`/noise helpers for high-frequency terrain sampling unless a feature explicitly requires Thoth-compatible output.

## Out of scope

- Replacing current terrain hashes or changing existing world output.
- Reproducing Lua `nil`/`false` argument coercion; the GDScript API accepts integers only.
- Cross-runtime compatibility with a non-LuaJIT bit-operation implementation.
