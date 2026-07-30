class_name WorldOrometry
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")
const SCALE = preload("res://scripts/world_scale.gd")
const ARCHETYPES := [
	{"id": 1, "key": "alps", "name": "Alps", "peak_prominence_hist": [0.02, 0.03, 0.05, 0.07, 0.09, 0.11, 0.12, 0.13, 0.12, 0.10, 0.07, 0.04, 0.025, 0.015, 0.008, 0.002], "saddle_prominence_hist": [0.04, 0.06, 0.08, 0.11, 0.13, 0.14, 0.13, 0.11, 0.08, 0.055, 0.035, 0.02, 0.01, 0.006, 0.003, 0.001], "peak_density_per_km2": 0.42, "ridgeline_spacing_mean": 3.8, "ridgeline_spacing_std": 1.4, "mean_slope": 0.34, "relief_p95": 1850.0, "relief_p50": 720.0, "peak_amp_scale": 1.30, "ridge_freq_scale": 1.16, "slope_bias": 0.055, "relief_scale": 1.28},
	{"id": 2, "key": "appalachians", "name": "Appalachians", "peak_prominence_hist": [0.11, 0.15, 0.17, 0.16, 0.13, 0.10, 0.07, 0.045, 0.025, 0.015, 0.008, 0.004, 0.002, 0.001, 0.0, 0.0], "saddle_prominence_hist": [0.13, 0.17, 0.18, 0.16, 0.12, 0.09, 0.06, 0.035, 0.02, 0.012, 0.006, 0.003, 0.001, 0.001, 0.0, 0.0], "peak_density_per_km2": 0.22, "ridgeline_spacing_mean": 7.6, "ridgeline_spacing_std": 2.9, "mean_slope": 0.16, "relief_p95": 690.0, "relief_p50": 260.0, "peak_amp_scale": 0.52, "ridge_freq_scale": 0.70, "slope_bias": -0.045, "relief_scale": 0.52},
	{"id": 3, "key": "himalaya", "name": "Himalaya", "peak_prominence_hist": [0.005, 0.01, 0.015, 0.025, 0.04, 0.06, 0.08, 0.10, 0.12, 0.13, 0.13, 0.11, 0.08, 0.055, 0.03, 0.01], "saddle_prominence_hist": [0.01, 0.015, 0.025, 0.04, 0.06, 0.085, 0.11, 0.13, 0.13, 0.115, 0.09, 0.065, 0.04, 0.025, 0.012, 0.003], "peak_density_per_km2": 0.55, "ridgeline_spacing_mean": 4.6, "ridgeline_spacing_std": 2.1, "mean_slope": 0.48, "relief_p95": 3300.0, "relief_p50": 1320.0, "peak_amp_scale": 2.20, "ridge_freq_scale": 1.12, "slope_bias": 0.120, "relief_scale": 2.00},
	{"id": 4, "key": "andes", "name": "Andes", "peak_prominence_hist": [0.01, 0.018, 0.03, 0.05, 0.075, 0.10, 0.12, 0.13, 0.12, 0.10, 0.075, 0.05, 0.03, 0.017, 0.008, 0.002], "saddle_prominence_hist": [0.018, 0.03, 0.05, 0.075, 0.10, 0.12, 0.13, 0.12, 0.10, 0.08, 0.055, 0.035, 0.02, 0.012, 0.004, 0.001], "peak_density_per_km2": 0.36, "ridgeline_spacing_mean": 6.4, "ridgeline_spacing_std": 2.6, "mean_slope": 0.39, "relief_p95": 2500.0, "relief_p50": 970.0, "peak_amp_scale": 1.65, "ridge_freq_scale": 0.92, "slope_bias": 0.080, "relief_scale": 1.58},
	{"id": 5, "key": "fjordland", "name": "Fjordland", "peak_prominence_hist": [0.008, 0.014, 0.025, 0.045, 0.07, 0.095, 0.12, 0.14, 0.14, 0.12, 0.09, 0.06, 0.04, 0.022, 0.01, 0.001], "saddle_prominence_hist": [0.012, 0.022, 0.04, 0.065, 0.095, 0.125, 0.14, 0.14, 0.12, 0.095, 0.065, 0.04, 0.025, 0.012, 0.003, 0.001], "peak_density_per_km2": 0.50, "ridgeline_spacing_mean": 3.1, "ridgeline_spacing_std": 1.2, "mean_slope": 0.44, "relief_p95": 2150.0, "relief_p50": 840.0, "peak_amp_scale": 1.75, "ridge_freq_scale": 1.42, "slope_bias": 0.100, "relief_scale": 1.72},
	{"id": 6, "key": "basinrange", "name": "Basin&Range", "peak_prominence_hist": [0.035, 0.055, 0.08, 0.105, 0.13, 0.14, 0.13, 0.105, 0.08, 0.055, 0.035, 0.02, 0.015, 0.008, 0.005, 0.002], "saddle_prominence_hist": [0.045, 0.07, 0.10, 0.13, 0.145, 0.14, 0.115, 0.085, 0.06, 0.04, 0.025, 0.015, 0.008, 0.004, 0.002, 0.001], "peak_density_per_km2": 0.31, "ridgeline_spacing_mean": 8.8, "ridgeline_spacing_std": 3.4, "mean_slope": 0.29, "relief_p95": 1180.0, "relief_p50": 430.0, "peak_amp_scale": 0.95, "ridge_freq_scale": 1.75, "slope_bias": 0.055, "relief_scale": 1.08},
]

static func profiles() -> Array:
	return ARCHETYPES.duplicate(true)

static func default_modifiers() -> Dictionary:
	return {"peak_amp_scale": 1.0, "ridge_freq_scale": 1.0, "slope_bias": 0.0, "relief_scale": 1.0}

static func pick(seed: int, world_x: float, world_z: float, scope: Variant = "local", chunk_size: int = 64, block_chunks: int = 4, halo_cells: int = 8) -> Dictionary:
	assert(chunk_size > 0 and block_chunks > 0 and halo_cells >= 0, "orometry block settings must be valid")
	var factor := int(SCALE.info(scope).get("factor", 1))
	var gx := floori(world_x / float(factor))
	var gz := floori(world_z / float(factor))
	var chunk_x := floori(float(gx) / float(chunk_size))
	var chunk_z := floori(float(gz) / float(chunk_size))
	var block_x := floori(float(chunk_x) / float(block_chunks))
	var block_z := floori(float(chunk_z) / float(block_chunks))
	var primary := _at(seed, block_x, block_z)
	var block_cells := chunk_size * block_chunks
	var local_x := posmod(gx, block_cells)
	var local_z := posmod(gz, block_cells)
	var left := local_x
	var right := block_cells - 1 - local_x
	var top := local_z
	var bottom := block_cells - 1 - local_z
	var edge := left
	var offset_x := -1
	var offset_z := 0
	if right < edge:
		edge = right
		offset_x = 1
		offset_z = 0
	if top < edge:
		edge = top
		offset_x = 0
		offset_z = -1
	if bottom < edge:
		edge = bottom
		offset_x = 0
		offset_z = 1
	var secondary := _at(seed, block_x + offset_x, block_z + offset_z) if edge < halo_cells else primary
	var blend := 1.0 if int(primary.id) == int(secondary.id) else _smoothstep(0.0, float(halo_cells), float(edge))
	return {"archetype": primary.duplicate(true), "id": primary.id, "blend": blend, "modifiers": _blend(primary, secondary, blend), "block_x": block_x, "block_z": block_z}

static func _at(seed: int, block_x: int, block_z: int) -> Dictionary:
	return ARCHETYPES[int(posmod(RNG.thoth_hash(seed, block_x, block_z, 1091), ARCHETYPES.size()))]

static func _blend(primary: Dictionary, secondary: Dictionary, blend: float) -> Dictionary:
	return {"peak_amp_scale": lerpf(float(secondary.peak_amp_scale), float(primary.peak_amp_scale), blend), "ridge_freq_scale": lerpf(float(secondary.ridge_freq_scale), float(primary.ridge_freq_scale), blend), "slope_bias": lerpf(float(secondary.slope_bias), float(primary.slope_bias), blend), "relief_scale": lerpf(float(secondary.relief_scale), float(primary.relief_scale), blend)}

static func _smoothstep(minimum: float, maximum: float, value: float) -> float:
	if maximum <= minimum:
		return 1.0
	var t := clampf((value - minimum) / (maximum - minimum), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
