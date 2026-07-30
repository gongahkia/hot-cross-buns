class_name WorldReefs
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var seed := int(options.get("seed", region.get("seed", 1))); var sea_level := float(options.get("sea_level", region.get("sea_level", 0.0)))
	var geologic_time_my := float(options.get("geologic_time_my", float(options.get("geologic_time", region.get("geologic_time", 0.0))) * 100.0)); var growth_rate := float(options.get("reef_growth_rate", 0.05))
	var stats := {"candidates": 0, "fringing": 0, "barrier": 0, "atoll": 0, "lagoon": 0, "submerged": 0}
	for cell: Dictionary in _cells(region):
		cell["reef_accretion"] = 0.0; cell["reef_age_my"] = 0.0; cell["reef_stage"] = 0
		if not _candidate(cell, sea_level): continue
		var seed_cell := _local_seed_cell(region, cell); var age := _reef_age_my(seed, seed_cell, geologic_time_my); var accretion := age * growth_rate
		var sub := float(options.get("force_subsidence", _subsidence(cell, options))); var stage := _stage_for(region, cell, accretion, sub, sea_level)
		cell["reef_age_my"] = age; cell["reef_accretion"] = accretion; cell["reef_stage"] = stage; stats["candidates"] = int(stats.candidates) + 1
		if stage == 1: stats["fringing"] = int(stats.fringing) + 1
		if stage == 2: stats["barrier"] = int(stats.barrier) + 1
		if stage == 3: stats["atoll"] = int(stats.atoll) + 1
		if stage == 4: stats["lagoon"] = int(stats.lagoon) + 1
		if stage == 5: stats["submerged"] = int(stats.submerged) + 1
		if stage >= 1 and stage <= 3: cell["elevation"] = maxf(_elevation(cell), sea_level + 0.002)
	region["reefs"] = stats
	return stats

static func _candidate(cell: Dictionary, sea_level: float) -> bool:
	return bool(cell.get("water", false)) and not bool(cell.get("lake", false)) and _latitude_unit(cell) < 0.4 and float(cell.get("temperature", 0.0)) > 0.62 and _elevation(cell) > sea_level - 0.08

static func _subsidence(cell: Dictionary, options: Dictionary) -> float:
	var thermal := maxf(0.0, (float(cell.get("ocean_depth_meters", 2600.0)) - 2600.0) / float(options.get("z_scale", 10000.0)))
	var hotspot := float(cell.get("hotspot_contribution", 0.0)) * (1.0 - exp(-maxf(0.0, float(cell.get("hotspot_age_my", 0.0))) / 30.0)) * 0.18
	return thermal + hotspot

static func _reef_age_my(seed: int, seed_cell: Dictionary, geologic_time_my: float) -> float:
	if geologic_time_my <= 0.0: return 0.0
	return maxf(0.0, geologic_time_my - RNG.unit_at(seed, _gx(seed_cell), _gy(seed_cell), 1061) * geologic_time_my)

static func _stage_for(region: Dictionary, cell: Dictionary, accretion: float, sub: float, sea_level: float) -> int:
	if accretion < sub - 0.02: return 5
	if sub < 0.005 and _adjacent_land(region, cell, 1): return 1
	if sub < 0.04: return 2
	if _adjacent_land(region, cell, 3): return 2
	return 3 if _elevation(cell) > sea_level - 0.045 else 4

static func _local_seed_cell(region: Dictionary, cell: Dictionary) -> Dictionary:
	var best := cell; var grid: Dictionary = region.get("cells", {})
	for gy in range(_gy(cell) - 4, _gy(cell) + 5):
		for gx in range(_gx(cell) - 4, _gx(cell) + 5):
			var neighbor: Dictionary = grid.get(_key(gx, gy), {})
			if not neighbor.is_empty() and float(neighbor.get("elevation", -1.0)) > float(best.get("elevation", -1.0)): best = neighbor
	return best

static func _adjacent_land(region: Dictionary, cell: Dictionary, radius: int) -> bool:
	var grid: Dictionary = region.get("cells", {})
	for gy in range(_gy(cell) - radius, _gy(cell) + radius + 1):
		for gx in range(_gx(cell) - radius, _gx(cell) + radius + 1):
			var neighbor: Dictionary = grid.get(_key(gx, gy), {})
			if not neighbor.is_empty() and not bool(neighbor.get("water", false)): return true
	return false

static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
static func _key(gx: int, gy: int) -> String: return "%d:%d" % [gx, gy]
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx", 0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy", 0))
static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation", cell.get("elevation_base", 0.0)))
static func _latitude_unit(cell: Dictionary) -> float: return absf(float(cell.get("latitude_radians", 0.0))) / (PI * 0.5)
