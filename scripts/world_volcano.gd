class_name WorldVolcano
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")
const NEIGHBORS := [
	{"x": -1, "y": -1, "distance": 1.41421356237}, {"x": 0, "y": -1, "distance": 1.0}, {"x": 1, "y": -1, "distance": 1.41421356237},
	{"x": -1, "y": 0, "distance": 1.0}, {"x": 1, "y": 0, "distance": 1.0},
	{"x": -1, "y": 1, "distance": 1.41421356237}, {"x": 0, "y": 1, "distance": 1.0}, {"x": 1, "y": 1, "distance": 1.41421356237},
]

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var arc_threshold := float(options.get("arc_threshold", 0.04))
	var hotspot_threshold := float(options.get("hotspot_threshold", 0.25))
	var seed := int(options.get("seed", region.get("seed", 1)))
	var candidates: Array = []
	for cell: Dictionary in _cells(region):
		cell["volcanic_form"] = 0; cell["volcanic_age_my"] = 0.0
		var values := _intensity(cell, arc_threshold, hotspot_threshold)
		if float(values.score) > 0.0 and not bool(cell.get("water", false)) and _local_maximum(region, cell, arc_threshold, hotspot_threshold): candidates.append(cell)
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ah := RNG.thoth_hash(seed, _gx(a), _gy(a), 1229)
		var bh := RNG.thoth_hash(seed, _gx(b), _gy(b), 1229)
		if ah == bh: return _gx(a) < _gx(b) if _gy(a) == _gy(b) else _gy(a) < _gy(b)
		return ah < bh
	)
	candidates = _prune(candidates, float(options.get("min_spacing", 8.0)))
	var stats := {"candidates": candidates.size(), "strato_cones": 0, "calderas": 0, "lava_flows": 0, "lava_flow_cells": 0, "shields": 0, "cinder_cones": 0, "affected_cells": 0, "max_delta": 0.0}
	var max_features := int(options.get("max_features", maxi(1, floori(float(candidates.size()) * float(options.get("density", 0.35))))))
	for index in range(mini(candidates.size(), max_features)):
		var center: Dictionary = candidates[index]
		var values := _intensity(center, arc_threshold, hotspot_threshold)
		var arc := float(values.arc); var hotspot := float(values.hotspot)
		var age := float(center.get("hotspot_age_my", 0.0)) + RNG.unit_at(seed, _gx(center), _gy(center), 1231) * (60.0 if hotspot > arc else 6.0)
		center["volcanic_age_my"] = age
		var kind := int(options.get("force_kind", _kind(center, arc, hotspot, hotspot_threshold)))
		var radius := _stamp_cone(region, center, kind, seed, stats)
		if kind == 1: stats["strato_cones"] = int(stats.strato_cones) + 1
		if kind == 4: stats["shields"] = int(stats.shields) + 1
		if kind == 5: stats["cinder_cones"] = int(stats.cinder_cones) + 1
		if kind == 1 and (bool(options.get("force_caldera", false)) or RNG.unit_at(seed, _gx(center), _gy(center), 1237) < 0.3): _stamp_caldera(region, center, radius, stats)
		_stamp_flow(region, center, seed, stats)
		if kind == 4 and RNG.unit_at(seed, _gx(center), _gy(center), 1239) < 0.45: _stamp_cinder_field(region, center, seed, stats)
	region["volcanoes"] = stats
	return stats

static func classify_fumaroles(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var allow_exotic := bool(options.get("allow_exotic", region.get("allow_exotic", false)))
	var fields := 0
	for cell: Dictionary in _cells(region):
		var temperature := float(cell.get("temperature", 0.5))
		var precipitation := float(cell.get("precipitation", cell.get("rainfall", 0.5)))
		var field := is_fumarole_field(cell, temperature, precipitation, allow_exotic)
		cell["fumarole_field"] = field
		if field: fields += 1
	var stats := {"fumarole_cells": fields}
	region["fumaroles"] = stats
	return stats

static func is_fumarole_field(cell: Dictionary, temperature: float, precipitation: float, allow_exotic: bool = false) -> bool:
	var elevation := _elevation(cell); var slope := float(cell.get("slope", 0.0)); var hotspot := float(cell.get("hotspot_contribution", 0.0))
	if int(cell.get("reef_stage", 0)) > 0 or bool(cell.get("water", false)) or bool(cell.get("is_flood_basalt", false)) or int(cell.get("karst_type", 0)) > 0: return false
	if allow_exotic and ((temperature > 0.74 and precipitation > 0.88 and elevation < 0.22) or (temperature < 0.16 and elevation > 0.62) or (precipitation < 0.1 and elevation < 0.22 and slope < 0.04)): return false
	if hotspot > 0.25 and slope < 0.2: return false
	if int(cell.get("volcanic_form", 0)) == 2 and precipitation > 0.44: return false
	if int(cell.get("volcanic_form", 0)) > 0 and precipitation < 0.28: return false
	return hotspot > 0.18 and slope < 0.12 and temperature > 0.42

static func _intensity(cell: Dictionary, arc_threshold: float, hotspot_threshold: float) -> Dictionary:
	var arc := clampf((float(cell.get("volcanic_island_arc", 0.0)) - arc_threshold) / maxf(0.001, 0.12 - arc_threshold), 0.0, 1.0)
	var hotspot := clampf((float(cell.get("hotspot_contribution", 0.0)) - hotspot_threshold) / maxf(0.001, 0.45 - hotspot_threshold), 0.0, 1.0)
	return {"score": maxf(arc, hotspot), "arc": arc, "hotspot": hotspot}

static func _local_maximum(region: Dictionary, cell: Dictionary, arc_threshold: float, hotspot_threshold: float) -> bool:
	var current := float(_intensity(cell, arc_threshold, hotspot_threshold).score)
	var grid: Dictionary = region.get("cells", {})
	for offset: Dictionary in NEIGHBORS:
		var neighbor: Dictionary = grid.get("%d:%d" % [_gx(cell) + int(offset.x), _gy(cell) + int(offset.y)], {})
		if not neighbor.is_empty() and float(_intensity(neighbor, arc_threshold, hotspot_threshold).score) > current: return false
	return true

static func _kind(cell: Dictionary, arc: float, hotspot: float, hotspot_threshold: float) -> int:
	if hotspot >= arc and (int(cell.get("lithology", 0)) == 1 or bool(cell.get("is_flood_basalt", false)) or float(cell.get("hotspot_contribution", 0.0)) > hotspot_threshold): return 4
	return 1 if arc > 0.0 else 5

static func _stamp_cone(region: Dictionary, center: Dictionary, kind: int, seed: int, stats: Dictionary) -> int:
	var gx0 := _gx(center); var gy0 := _gy(center); var peak := 0.04; var scale := 1.5
	if kind == 4:
		peak = 0.08 + RNG.unit_at(seed, gx0, gy0, 1201) * 0.06; scale = 5.0 + RNG.unit_at(seed, gx0, gy0, 1203) * 3.0
	elif kind == 1:
		peak = 0.18 + RNG.unit_at(seed, gx0, gy0, 1201) * 0.14; scale = 2.0 + RNG.unit_at(seed, gx0, gy0, 1203) * 2.0
	var radius := ceili(scale * 3.0); var affected := 0; var max_delta := 0.0
	var grid: Dictionary = region.get("cells", {})
	for gy in range(gy0 - radius, gy0 + radius + 1):
		for gx in range(gx0 - radius, gx0 + radius + 1):
			var cell: Dictionary = grid.get("%d:%d" % [gx, gy], {})
			if cell.is_empty() or bool(cell.get("water", false)): continue
			var distance := Vector2(float(gx - gx0), float(gy - gy0)).length()
			if distance > float(radius): continue
			var delta := peak * exp(-distance / scale)
			_add_elevation(cell, delta); cell["slope"] = clampf(float(cell.get("slope", 0.0)) + delta * (0.18 if kind == 4 else 0.38), 0.0, 1.0); _set_form(cell, kind, float(center.get("volcanic_age_my", 0.0)))
			affected += 1; max_delta = maxf(max_delta, delta)
	stats["affected_cells"] = int(stats.affected_cells) + affected; stats["max_delta"] = maxf(float(stats.max_delta), max_delta)
	return radius

static func _stamp_caldera(region: Dictionary, center: Dictionary, radius: int, stats: Dictionary) -> void:
	var gx0 := _gx(center); var gy0 := _gy(center); var caldera_radius := maxi(1, floori(float(radius) * 0.38)); var cells := 0
	var grid: Dictionary = region.get("cells", {})
	for gy in range(gy0 - caldera_radius, gy0 + caldera_radius + 1):
		for gx in range(gx0 - caldera_radius, gx0 + caldera_radius + 1):
			var cell: Dictionary = grid.get("%d:%d" % [gx, gy], {})
			if cell.is_empty() or bool(cell.get("water", false)): continue
			var distance := Vector2(float(gx - gx0), float(gy - gy0)).length()
			if distance > float(caldera_radius): continue
			var delta := -0.14 * (1.0 + cos(distance * PI / float(caldera_radius))) * 0.5
			_add_elevation(cell, delta); _set_form(cell, 2, float(center.get("volcanic_age_my", 0.0))); cell["slope"] = clampf(float(cell.get("slope", 0.0)) + absf(delta) * 0.15, 0.0, 1.0); cells += 1
	if cells > 0: stats["calderas"] = int(stats.calderas) + 1

static func _stamp_flow(region: Dictionary, center: Dictionary, seed: int, stats: Dictionary) -> void:
	var steps := 8 + floori(RNG.unit_at(seed, _gx(center), _gy(center), 1211) * 9.0); var cell := center; var flow_cells := 0
	for step in range(1, steps + 1):
		var next_cell := _steepest_down(region, cell)
		if next_cell.is_empty(): break
		_add_elevation(next_cell, 0.01 * (1.0 - float(step - 1) / float(steps))); _set_form(next_cell, 3, float(center.get("volcanic_age_my", 0.0))); flow_cells += 1; cell = next_cell
	if flow_cells > 0:
		stats["lava_flows"] = int(stats.lava_flows) + 1; stats["lava_flow_cells"] = int(stats.lava_flow_cells) + flow_cells

static func _stamp_cinder_field(region: Dictionary, center: Dictionary, seed: int, stats: Dictionary) -> void:
	var count := 5 + floori(RNG.unit_at(seed, _gx(center), _gy(center), 1221) * 6.0); var grid: Dictionary = region.get("cells", {})
	for index in range(1, count + 1):
		var angle := RNG.unit_at(seed, _gx(center), _gy(center), 1223 + index) * TAU
		var radius := 2.0 + RNG.unit_at(seed, _gx(center), _gy(center), 1241 + index) * 5.0
		var cell: Dictionary = grid.get("%d:%d" % [floori(float(_gx(center)) + cos(angle) * radius + 0.5), floori(float(_gy(center)) + sin(angle) * radius + 0.5)], {})
		if cell.is_empty() or bool(cell.get("water", false)): continue
		cell["volcanic_age_my"] = float(center.get("volcanic_age_my", 0.0)); _stamp_cone(region, cell, 5, seed + index * 17, stats); stats["cinder_cones"] = int(stats.cinder_cones) + 1

static func _steepest_down(region: Dictionary, cell: Dictionary) -> Dictionary:
	var best: Dictionary = {}; var best_drop := 0.0; var elevation := _elevation(cell); var grid: Dictionary = region.get("cells", {})
	for offset: Dictionary in NEIGHBORS:
		var next_cell: Dictionary = grid.get("%d:%d" % [_gx(cell) + int(offset.x), _gy(cell) + int(offset.y)], {})
		if next_cell.is_empty() or bool(next_cell.get("water", false)): continue
		var drop := (elevation - _elevation(next_cell)) / float(offset.distance)
		if drop > best_drop: best = next_cell; best_drop = drop
	return best

static func _set_form(cell: Dictionary, form: int, age: float) -> void:
	if form != 3 or int(cell.get("volcanic_form", 0)) in [0, 4, 5]: cell["volcanic_form"] = form
	cell["volcanic_age_my"] = maxf(float(cell.get("volcanic_age_my", 0.0)), age)

static func _add_elevation(cell: Dictionary, delta: float) -> void:
	var base := _elevation(cell); var elevation := float(cell.get("elevation", base)); var bedrock := float(cell.get("bedrock_elevation", base))
	cell["elevation_base"] = base + delta; cell["elevation"] = elevation + delta; cell["bedrock_elevation"] = bedrock + delta

static func _prune(candidates: Array, min_distance: float) -> Array:
	var kept: Array = []
	for candidate: Dictionary in candidates:
		var valid := true
		for other: Dictionary in kept:
			if Vector2(float(_gx(candidate) - _gx(other)), float(_gy(candidate) - _gy(other))).length_squared() < min_distance * min_distance: valid = false; break
		if valid: kept.append(candidate)
	return kept

static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx", 0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy", 0))
static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation_base", cell.get("elevation", 0.0)))
