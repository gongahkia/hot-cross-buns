# Worker-thread payload serialization contract

## Boundary

Workers receive immutable data-only requests and return immutable data-only responses. They do not receive `Node`, `Object`, `Resource`, `RID`, `Callable`, signal, file handle, scene-tree reference, autoload reference, or live engine-local transform. Workers neither create nor mutate Godot scene objects.

The main thread owns validation, cache mutation, node creation, collision/mesh construction when engine APIs require it, and payload attachment.

## Wire values

Payloads use only these recursively composable values:

- `null`, boolean, UTF-8 string, signed 64-bit integer, and finite numeric scalar;
- arrays with a documented item type and stable order;
- dictionaries with string keys and stable canonical key order;
- `PackedByteArray`, `PackedInt32Array`, `PackedInt64Array`, `PackedFloat32Array`, or `PackedFloat64Array` only when the field declares element width, count, byte order, and unit;
- coordinate/vector/color values encoded as documented numeric arrays, not engine objects.

NaN, infinity, implicit object serialization, arbitrary dictionary iteration order, and schema-less `Variant` blobs are rejected at the boundary.

## Request envelope

```text
ChunkRequest {
  payload_schema_version: int,
  world_id: { seed: decimal_string, generator_schema_version: string, options_hash: string },
  key: { chunk_x: int64, chunk_z: int64, lod: int },
  generation_epoch: int64,
  request_token: int64,
  parameters: canonical dictionary
}
```

The request contains canonical world coordinates only. `origin_chunk`, Godot node paths, screen resolution, frame time, and input state are presentation/runtime concerns and are forbidden.

## Response envelope

```text
ChunkResponse {
  payload_schema_version: int,
  world_id: same_as_request,
  key: same_as_request,
  generation_epoch: same_as_request,
  request_token: same_as_request,
  status: "ok" | "cancelled" | "failed",
  data: canonical dictionary | null,
  error: stable_error_code | null,
  metrics: { generation_us: int64, bytes: int64 } | null
}
```

`status == "ok"` requires validated `data`; every other status requires `data == null`. Error text is diagnostic-only and not part of deterministic identity or fixtures.

## Validation and evolution

1. Validate type, field presence, scalar finiteness, packed-array size, and schema version before worker execution and again before main-thread attachment.
2. Include every generation-affecting parameter in the canonical request; workers may not read global options or process-local defaults.
3. A new optional field requires an explicit deterministic default and a payload-schema minor increment. Removing/reinterpreting a field requires a major increment and rejects old payloads unless an adapter is tested.
4. Main-thread attachment accepts a response only after the lifecycle contract validates identity, key, epoch, and token.
5. Payload hashes use a canonical encoding that includes schema version, keys, element widths, and units; they never hash debug metrics or error text.
6. Bound payload size per LOD before queueing. Oversize data fails with a stable error code and cannot exhaust the main-thread queue.

## Verification

Headless tests round-trip each schema sample, reject forbidden/malformed values, reject mismatched identity/token, verify canonical hash equality across repeated runs, and verify that cancelled/failed responses attach no Godot nodes. Fixtures include negative coordinates and the largest supported packed array for each LOD.

## Dependencies

- Chunk lifecycle/cancellation, deterministic identity, coordinate/origin policy, scheduler, cache, and telemetry contracts.
- A Godot threading mechanism with a bounded handoff queue.

## Performance impact

Validation is linear in payload size and occurs at bounded handoff points. Plain payloads trade some encoding/copy cost for thread isolation and stale-result rejection; profile large LOD payloads before increasing concurrency or active radius.

## Out of scope

- A particular binary format, compression codec, worker API, or process boundary.
- Serializing scene graphs, live physics state, GPU resources, or arbitrary Godot `Variant` values.
- Cross-platform byte-identical floating-point mesh construction.
