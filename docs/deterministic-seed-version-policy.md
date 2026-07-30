# Deterministic seed/version compatibility policy

## Identity

An expedition world is identified by the tuple:

```text
world_id = (seed, generator_schema_version, generation_options)
```

- `seed` is a signed 64-bit integer serialized as decimal text.
- `generator_schema_version` is a semantic version owned by the authoritative Godot generation contract.
- `generation_options` contains only versioned, generation-affecting values in canonical key order. Presentation, input, audio, accessibility, debug, and performance settings are excluded.

A run record, shared seed, fixture, screenshot metadata entry, and run card must retain this full tuple whenever it claims to identify generated world content.

## Versioning rules

| Change | Version action | Compatibility result |
| --- | --- | --- |
| Internal refactor whose descriptors are byte-for-byte unchanged | no change | compatible |
| Add optional data that has a deterministic default and does not alter existing descriptors | patch | compatible after defaulting |
| Add a generation option that changes only newly opted-in worlds | minor | compatible only when the option set is retained |
| Change hash/noise behavior, coordinate units, generation order, default option, terrain/biome/resource/landmark output, or serialization meaning | major | incompatible |
| Fix a determinism defect whose old output is not reproducible by the corrected implementation | major | incompatible; preserve old reader/generator or reject explicitly |

Version labels do not make worlds compatible by themselves. Compatibility is demonstrated by golden descriptors at fixed coordinates and explicit option sets.

## Required behavior

1. New runs write the current full identity before any generated state is persisted.
2. A loader compares all identity fields before restoring a world-derived record.
3. A compatible prior schema may be migrated only through a deterministic, tested mapping that preserves its declared identity.
4. An incompatible record is never silently regenerated under the current schema. The UI must identify the incompatibility and offer a safe action such as archive, export metadata, or start a new run.
5. The current generator may not read wall time, process-random state, unordered dictionary iteration, device state, or loading history to determine world output.
6. Golden tests cover at least negative and positive coordinates, region boundaries, chunk seams, every region family, and every persisted generation option.

## Canonicalization

- Integer coordinates are chunk/region indices, not formatted floating-point positions.
- Float generation options are avoided. If unavoidable, serialize an integer fixed-point unit and document its scale.
- Dictionaries are converted to a fixed, documented key order before hashing or writing a fixture.
- User-facing seed strings are parsed strictly as base-10 integers; malformed, out-of-range, and ambiguous values fail before run creation.

## Dependencies

- A single Godot-owned source for `generator_schema_version`.
- Versioned run-record/save schemas and atomic local-save recovery.
- Deterministic RNG/noise primitives, coordinate policy, and golden fixture suite.

## Performance impact

Identity comparisons and canonical option encoding occur at run creation/load and fixture generation, not in the per-frame generation path. Golden fixtures should hash bounded descriptors rather than serialize unbounded chunk meshes.

## Out of scope

- Cross-platform bit-identical GPU rendering, screenshots, audio, physics contact timing, or frame rate.
- Backporting every historical prototype seed.
- Guaranteeing compatibility after a deliberate major generation change.
- Encrypting, signing, or cloud-synchronizing run records.
