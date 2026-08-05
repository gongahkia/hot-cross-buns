class_name WorldAeolian
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")
const NEIGHBORS := [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var seed := int(options.get("seed", region.get("seed", 1)))
	var cells := _candidates(region, options)
	if cells.is_empty():
		var empty := {"cells": 0, "active_cells": 0, "morphology": "none", "iterations": 0}
		region["dunes"] = empty
		return empty
	var sand_total := 0
	var fallback := Vector2.ZERO
	for cell: Dictionary in cells:
		cell["_dune_sand"] = maxf(0.0, float(cell.get("dune_sand", 1.0 if RNG.unit_at(seed, int(cell.gx), int(cell.gy), 1207) < float(options.get("sand_cover", 0.45)) else 0.0)))
		sand_total += int(cell._dune_sand)
		fallback += Vector2(float(cell.get("wind_x", 0.0)), float(cell.get("wind_y", 0.0)))
	var directions := _directions(options, fallback / float(cells.size()))
	var iterations := int(options.get("iterations", floori(float(cells.size()) * float(options.get("iterations_per_cell", 10.0)))))
	var moved := 0
	for iteration in range(1, iterations + 1):
		var index := mini(cells.size() - 1, floori(RNG.unit_at(seed, iteration, cells.size(), 1709) * float(cells.size())))
		var direction := _direction(directions, seed, iteration)
		if _transport(region, cells[index], direction, seed, iteration, options): moved += 1
	var mean_sand := 0.0
	for cell: Dictionary in cells: mean_sand += float(cell._dune_sand)
	mean_sand /= float(cells.size())
	var morphology := str(options.get("morphology", _morphology(float(sand_total) / float(cells.size()), directions)))
	var active := 0
	var max_amplitude := 0.0
	var slab := float(options.get("slab_height", 0.005))
	for cell: Dictionary in cells:
		var delta := clampf((float(cell._dune_sand) - mean_sand) * slab, -0.08, 0.08)
		cell["dune_delta"] = delta
		cell["dune_amplitude"] = absf(delta)
		cell["dune_phase"] = float(cell.gx) * float((directions[0] as Dictionary).x) + float(cell.gy) * float((directions[0] as Dictionary).y)
		cell["dune_morphology"] = morphology
		cell["elevation"] = float(cell.get("elevation", cell.get("elevation_base", 0.0))) + delta
		cell["slope"] = clampf(float(cell.get("slope", 0.0)) + absf(delta) * 1.6, 0.0, 1.0)
		active += 1 if absf(delta) > 0.0 else 0
		max_amplitude = maxf(max_amplitude, absf(delta))
		cell.erase("_dune_sand")
	var result := {"cells": cells.size(), "active_cells": active, "moved": moved, "sand_cover": float(sand_total) / float(cells.size()), "morphology": morphology, "max_amplitude": max_amplitude, "iterations": iterations}
	region["dunes"] = result
	return result

static func _transport(region: Dictionary, cell: Dictionary, wind: Vector2, seed: int, iteration: int, options: Dictionary) -> bool:
	if float(cell.get("_dune_sand", 0.0)) <= 0.0 or _shadowed(region, cell, wind, options): return false
	var gx := int(cell.gx)
	var gy := int(cell.gy)
	cell["_dune_sand"] = float(cell._dune_sand) - 1.0
	var jump := int(options.get("transport_jump", 3))
	for hop in range(1, int(options.get("max_transport_hops", 5)) + 1):
		gx += roundi(wind.x * jump)
		gy += roundi(wind.y * jump)
		var target: Dictionary = (region.get("cells", {}) as Dictionary).get("%d:%d" % [gx, gy], {})
		if target.is_empty() or not _sand(target, options): break
		var chance := float(options.get("p_sand", 0.6)) if float(target.get("_dune_sand", 0.0)) > 0.0 else float(options.get("p_rock", 0.4))
		if RNG.unit_at(seed, iteration, hop, gx, gy) < chance:
			target["_dune_sand"] = float(target.get("_dune_sand", 0.0)) + 1.0
			_repose(region, target, options)
			_repose(region, cell, options)
			return true
	cell["_dune_sand"] = float(cell._dune_sand) + 1.0
	return false

static func _repose(region: Dictionary, start: Dictionary, options: Dictionary) -> void:
	var queue: Array = [start]
	var slab := float(options.get("slab_height", 0.005))
	var limit := 0
	while not queue.is_empty() and limit < 64:
		limit += 1
		var cell: Dictionary = queue.pop_back()
		for offset in NEIGHBORS:
			var neighbor: Dictionary = (region.get("cells", {}) as Dictionary).get("%d:%d" % [int(cell.gx) + offset.x, int(cell.gy) + offset.y], {})
			if not neighbor.is_empty() and _sand(neighbor, options) and _height(cell, slab) - _height(neighbor, slab) > slab and float(cell.get("_dune_sand", 0.0)) > 0.0:
				cell["_dune_sand"] = float(cell._dune_sand) - 1.0
				neighbor["_dune_sand"] = float(neighbor.get("_dune_sand", 0.0)) + 1.0
				queue.append(neighbor)

static func _shadowed(region: Dictionary, cell: Dictionary, wind: Vector2, options: Dictionary) -> bool:
	var slab := float(options.get("slab_height", 0.005))
	var base := _height(cell, slab)
	var tangent := tan(deg_to_rad(float(options.get("shadow_angle_degrees", 15.0))))
	for step in range(1, int(options.get("shadow_cells", 12)) + 1):
		var upstream: Dictionary = (region.get("cells", {}) as Dictionary).get("%d:%d" % [int(cell.gx) - roundi(wind.x * step), int(cell.gy) - roundi(wind.y * step)], {})
		if not upstream.is_empty() and _height(upstream, slab) - base > float(step) * slab * tangent: return true
	return false

static func _directions(options: Dictionary, fallback: Vector2) -> Array:
	var wind := Vector2(float(options.get("wind_x", fallback.x if fallback.length() > 0.0 else 1.0)), float(options.get("wind_y", fallback.y))).normalized()
	if str(options.get("wind_regime", "")) == "bimodal": return [{"x": wind.x, "y": wind.y, "weight": 0.6}, {"x": -wind.y, "y": wind.x, "weight": 0.4}]
	if str(options.get("wind_regime", "")) in ["multimodal", "star"]: return [{"x": wind.x, "y": wind.y, "weight": 0.34}, {"x": -wind.y, "y": wind.x, "weight": 0.33}, {"x": -wind.x, "y": -wind.y, "weight": 0.33}]
	return [{"x": wind.x, "y": wind.y, "weight": 1.0}]
static func _direction(directions: Array, seed: int, iteration: int) -> Vector2:
	var roll := RNG.unit_at(seed, iteration, 11)
	var total := 0.0
	for direction: Dictionary in directions:
		total += float(direction.weight)
		if roll <= total: return Vector2(float(direction.x), float(direction.y)).normalized()
	return Vector2(float((directions.back() as Dictionary).x), float((directions.back() as Dictionary).y)).normalized()
static func _morphology(cover: float, directions: Array) -> String:
	if directions.size() >= 3: return "star"
	if directions.size() == 2: return "seif"
	return "transverse" if cover >= 0.65 else "barchan" if cover <= 0.45 else "parabolic"
static func _height(cell: Dictionary, slab: float) -> float: return float(cell.get("elevation_base", cell.get("elevation", 0.0))) + float(cell.get("_dune_sand", 0.0)) * slab
static func _sand(cell: Dictionary, options: Dictionary) -> bool: return not bool(cell.get("water", false)) and not bool(cell.get("river", false)) and not bool(cell.get("lake", false)) and (bool(options.get("allow_all", false)) or str(cell.get("biome", "")) == "desert")
static func _candidates(region: Dictionary, options: Dictionary) -> Array:
	var cells: Array = []
	for cell: Dictionary in (region.get("cells", {}) as Dictionary).values():
		cell["dune_delta"] = 0.0; cell["dune_amplitude"] = 0.0; cell["dune_phase"] = 0.0; cell.erase("dune_morphology")
		if _sand(cell, options): cells.append(cell)
	cells.sort_custom(func(a: Dictionary, b: Dictionary): return int(a.gy) < int(b.gy) or (int(a.gy) == int(b.gy) and int(a.gx) < int(b.gx)))
	return cells
