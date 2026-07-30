class_name WorldBathymetry
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")
const NEIGHBORS := [
	{"x": -1, "y": -1, "distance": 1.41421356237}, {"x": 0, "y": -1, "distance": 1.0}, {"x": 1, "y": -1, "distance": 1.41421356237},
	{"x": -1, "y": 0, "distance": 1.0}, {"x": 1, "y": 0, "distance": 1.0},
	{"x": -1, "y": 1, "distance": 1.41421356237}, {"x": 0, "y": 1, "distance": 1.0}, {"x": 1, "y": 1, "distance": 1.41421356237},
]

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var seed := int(options.get("seed", region.get("seed", 1))); var sea_level := float(options.get("sea_level", region.get("sea_level", 0.0)))
	var stats := {"candidates": 0, "canyons": 0, "canyon_cells": 0, "max_incision": 0.0}; var candidates: Array = []
	for cell: Dictionary in _cells(region): cell["submarine_canyon"] = false
	var threshold := float(region.get("threshold", region.get("river_threshold", 64.0))); var density := float(options.get("canyon_density", 0.08))
	for cell: Dictionary in _cells(region):
		if is_shelf(cell, sea_level) and (_adjacent_land(region, cell) or float(cell.get("flow", 0.0)) > threshold * 0.2) and RNG.unit_at(seed, _gx(cell), _gy(cell), 1401) < density: candidates.append(cell)
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ah := RNG.thoth_hash(seed, _gx(a), _gy(a), 1405); var bh := RNG.thoth_hash(seed, _gx(b), _gy(b), 1405)
		if ah == bh: return _gx(a) < _gx(b) if _gy(a) == _gy(b) else _gy(a) < _gy(b)
		return ah < bh
	)
	stats["candidates"] = candidates.size()
	for cell: Dictionary in candidates:
		var steps := 8 + floori(RNG.unit_at(seed, _gx(cell), _gy(cell), 1403) * 9.0); var current := cell; var canyon_cells := 0
		for step in range(1, steps + 1):
			var amount := 0.015 * (1.0 - float(step - 1) / float(steps))
			_incise(current, amount); stats["max_incision"] = maxf(float(stats.max_incision), amount); stats["canyon_cells"] = int(stats.canyon_cells) + 1; canyon_cells += 1
			var next_cell := _steepest_ocean(region, current)
			if next_cell.is_empty(): break
			current = next_cell
		if canyon_cells > 0: stats["canyons"] = int(stats.canyons) + 1
	region["bathymetry"] = stats
	return stats

static func is_shelf(cell: Dictionary, sea_level: float = 0.0) -> bool:
	return bool(cell.get("water", false)) and not bool(cell.get("lake", false)) and float(cell.get("shelf_distance", 999.0)) < 30.0 and _elevation(cell) > sea_level - 0.14

static func seamount_at(seed: int, world_x: float, world_z: float, scale_factor: float, plate: Dictionary, shelf_proximity: float = 0.0) -> float:
	if str(plate.get("crust", "")) != "oceanic" or shelf_proximity > 0.45: return 0.0
	var spacing := 10.0 * scale_factor; var ix := floori(world_x / spacing); var iz := floori(world_z / spacing); var contribution := 0.0; var radius := 1.5 * scale_factor
	for gy in range(iz - 1, iz + 2):
		for gx in range(ix - 1, ix + 2):
			if RNG.unit_at(seed, gx, gy, 1411) >= 0.18: continue
			var center_x := (float(gx) + 0.5) * spacing + RNG.thoth_signed(seed, gx, gy, 1413) * spacing * 0.35
			var center_z := (float(gy) + 0.5) * spacing + RNG.thoth_signed(seed, gx, gy, 1415) * spacing * 0.35
			contribution = maxf(contribution, 0.08 * exp(-((world_x - center_x) * (world_x - center_x) + (world_z - center_z) * (world_z - center_z)) / (radius * radius)))
	return contribution

static func _adjacent_land(region: Dictionary, cell: Dictionary) -> bool:
	var grid: Dictionary = region.get("cells", {})
	for offset: Dictionary in NEIGHBORS:
		var neighbor: Dictionary = grid.get(_key(_gx(cell) + int(offset.x), _gy(cell) + int(offset.y)), {})
		if not neighbor.is_empty() and not bool(neighbor.get("water", false)): return true
	return false

static func _steepest_ocean(region: Dictionary, cell: Dictionary) -> Dictionary:
	var best: Dictionary = {}; var best_drop := 0.0; var current_elevation := _elevation(cell); var grid: Dictionary = region.get("cells", {})
	for offset: Dictionary in NEIGHBORS:
		var next_cell: Dictionary = grid.get(_key(_gx(cell) + int(offset.x), _gy(cell) + int(offset.y)), {})
		if next_cell.is_empty() or not bool(next_cell.get("water", false)) or bool(next_cell.get("lake", false)): continue
		var drop := (current_elevation - _elevation(next_cell)) / float(offset.distance)
		if drop > best_drop: best = next_cell; best_drop = drop
	return best

static func _incise(cell: Dictionary, amount: float) -> void:
	cell["elevation_base"] = _elevation(cell) - amount
	cell["elevation"] = float(cell.get("elevation", cell.elevation_base)) - amount
	cell["bedrock_elevation"] = float(cell.get("bedrock_elevation", cell.elevation_base)) - amount
	cell["submarine_canyon"] = true

static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
static func _key(gx: int, gy: int) -> String: return "%d:%d" % [gx, gy]
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx", 0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy", 0))
static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation_base", cell.get("elevation", 0.0)))
