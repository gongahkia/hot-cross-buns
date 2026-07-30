# PC graphics-tier support matrix

## Status

This matrix defines intended support and test gates. It does not claim that an unimplemented quality selector, renderer switch, or hardware configuration is already shipped. Current project configuration defaults to Godot’s `gl_compatibility` renderer; tier selection and measured certification remain separate implementation work.

Godot classifies Compatibility as the widest-hardware renderer and Forward+/Mobile as RenderingDevice-based renderers that require newer graphics API support. See the official [renderer overview](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html) and [system requirements](https://docs.godotengine.org/en/stable/about/system_requirements.html).

| Tier | Intended hardware/API floor | Renderer | Target | Generation/presentation limits | Certification status |
| --- | --- | --- | --- | --- | --- |
| Compatibility | x86_64 PC; OpenGL 3.3-capable GPU, or Direct3D 11 where Godot’s Compatibility path provides it; 8 GiB system RAM | `gl_compatibility` | 1280×720, 30 FPS | minimum active radius/LOD that preserves preload and collision; low vegetation/particles; no renderer-exclusive post-processing | unmeasured |
| Standard | x86_64 CPU with 4 physical cores; 4 GiB VRAM-class GPU; 16 GiB system RAM | `gl_compatibility` initially; Mobile only after explicit renderer validation | 1920×1080, 60 FPS | baseline active radius, full collision, medium vegetation/particles, standard photo capture | unmeasured |
| Enhanced | x86_64 CPU with 6 physical cores; 8 GiB VRAM-class GPU; 16 GiB system RAM; Vulkan 1.2, Direct3D 12, or Metal-capable path | Forward+ only after a separate renderer compatibility gate | 2560×1440, 60 FPS | increased visual LOD/distance and presentation detail; generated gameplay data unchanged | planned, unmeasured |

The hardware rows are product test classes, not a promise that every device with similar specifications performs identically. Godot engine requirements are a necessary runtime floor, not expedition performance certification.

## Tier invariants

1. Quality selection cannot change seed identity, generation options, region/biome/resource/hazard placement, traversal collision, survival simulation, run-record schema, or replay behavior.
2. Every supported tier retains a collision-complete preload corridor and readable traversal affordances. Detail may be reduced, but a lower tier cannot hide a required route or remove its collision without an equivalent safe representation.
3. A fallback is selected before entering an expedition when a renderer/API is unsupported; changing renderer during a run is unsupported until save/resume behavior is explicitly tested.
4. Tier options are local presentation preferences. They are excluded from shared seed strings, run cards, screenshot world identity, and deterministic fixtures.
5. Any setting that changes memory/streaming pressure declares its cap and is constrained by the world-generation and generated-content memory budgets.

## Required quality controls

| Control | Compatibility | Standard | Enhanced |
| --- | --- | --- |
| render scale | 0.75–1.0 | 0.85–1.0 | 1.0–1.25 |
| terrain/feature visual LOD | lowest safe | baseline | increased, memory-capped |
| foliage/prop density | low | medium | high, memory-capped |
| particles/fog | low | medium | high, quality-capped |
| shadows/post-process | compatibility-safe only | compatibility-safe only | Forward+-validated only |
| photo capture | standard-resolution path | standard-resolution path | high-resolution path after memory validation |

## Certification protocol

For each tier, test an exported build with the declared renderer at cold launch, a fixed 15-minute traversal, dense urban and natural regions, water/weather, photo-mode entry/capture, graphics-setting round trips, minimization/resume, and a clean exit. Record hardware/API/driver, Godot version, resolution, world identity, frame percentiles, memory pools, renderer errors, and visual/collision seam results. A tier is supported only after all stated gates pass on at least two representative devices in its class; otherwise label it experimental or unsupported.

## Dependencies

- Export validation workflows, renderer configuration, settings persistence, performance budget, memory budget, photo-mode implementation, and long-run stability tests.

## Performance impact

Tier selection bounds visual LOD, density, particles, render scale, and capture memory. It must not increase active generated-world state beyond the caps in the memory budget or move generation work into the frame loop.

## Out of scope

- macOS, mobile, web, VR, Steam Deck, handheld, or cloud-streaming certification.
- Vendor-specific GPU guarantees, ray tracing, HDR, ultrawide, or high-refresh certification.
- A claim that Forward+ works with the current Compatibility-only project configuration.
