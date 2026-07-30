# Flow accumulation

`WorldFlowAccumulation.seed_from_rainfall` ports Thoth’s per-cell flow seeding: `max(0.01, rainfall or precipitation) × stride²`. `accumulate(visit_order)` then walks the priority-flood/D8 visit order in reverse, adding each cell’s flow to its downstream parent with the source solver’s default `0.985` transmission factor.

`loss` may be set explicitly for the legacy local solve’s `0.965` factor. Callers must seed flows before one accumulation pass; repeated calls intentionally compound existing values.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flow_accumulation_test.gd
```

The fixture checks source-factor headwater-to-outlet accumulation, edge/statistic totals, rainfall/precipitation fallback, and stride-squared seeding.

## Dependencies

- D8 `down_cell` links and their parent-before-child priority-flood visit order.
- Caller-provided rainfall/precipitation values and region stride.

## Performance impact

Seeding and accumulation are linear in cell count, with no heap or spatial lookup. They mutate only caller-owned `flow` fields and allocate a statistics dictionary.

## Out of scope

- Depression filling, routing selection, river/lake classification, sediment transport, erosion, and cross-region flow transfer.
- Idempotent recomputation from an already accumulated flow field.
