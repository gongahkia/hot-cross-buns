class_name WorldPeriglacial
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var seed := int(options.get("seed", region.get("seed", 1)))
	var pingo_density := float(options.get("pingo_density", 0.05))
	var palsa_density := float(options.get("palsa_density", 0.04))
	var stats := {"cold_cells": 0, "pingos": 0, "palsas": 0, "polygons": 0, "solifluction": 0, "affected_cells": 0}
	for cell: Dictionary in _cells(region): cell["periglacial_feature"] = 0
	for cell: Dictionary in _cells(region):
		if not _cold(cell): continue
		stats["cold_cells"] = int(stats.cold_cells) + 1
		var gx := int(cell.gx)
		var gy := int(cell.gy)
		var slope := float(cell.get("slope", 0.0))
		var moisture := float(cell.get("moisture", cell.get("rainfall", 0.0)))
		if slope < 0.08 and (str(cell.get("biome", "")) == "tundra" or float(cell.get("temperature", 1.0)) < 0.18) and RNG.unit_at(seed, gx, gy, 1303) < pingo_density:
			var affected := _stamp(region, cell, 1, 0.005 + RNG.unit_at(seed, gx, gy, 1305) * 0.01)
			if affected > 0:
				stats["pingos"] = int(stats.pingos) + 1
				stats["affected_cells"] = int(stats.affected_cells) + affected
		elif slope < 0.06 and moisture > 0.45 and RNG.unit_at(seed, gx, gy, 1307) < palsa_density:
			var affected := _stamp(region, cell, 2, 0.003 + RNG.unit_at(seed, gx, gy, 1309) * 0.004)
			if affected > 0:
				stats["palsas"] = int(stats.palsas) + 1
				stats["affected_cells"] = int(stats.affected_cells) + affected
		elif _polygonal(cell, seed) and slope < 0.1:
			_set_feature(cell, 3)
			stats["polygons"] = int(stats.polygons) + 1
		elif slope >= 0.05 and slope <= 0.2:
			var ridge := (RNG.unit_at(seed, floori(float(gx) / 2.0), floori(float(gy) / 2.0), 1311) * 2.0 - 1.0) * 0.003
			_add_elevation(cell, ridge)
			_set_feature(cell, 4)
			stats["solifluction"] = int(stats.solifluction) + 1
			stats["affected_cells"] = int(stats.affected_cells) + 1
	region["periglacial"] = stats
	return stats

static func _stamp(region: Dictionary, center: Dictionary, feature: int, height: float) -> int:
	var affected := 0
	var cells: Dictionary = region.get("cells", {})
	for gy in range(int(center.gy) - 1, int(center.gy) + 2):
		for gx in range(int(center.gx) - 1, int(center.gx) + 2):
			var cell: Dictionary = cells.get("%d:%d" % [gx, gy], {})
			if cell.is_empty() or not _cold(cell): continue
			var distance := Vector2(float(gx - int(center.gx)), float(gy - int(center.gy))).length()
			if distance > 1.5: continue
			var delta := height * maxf(0.0, 1.0 - distance / 1.5)
			_add_elevation(cell, delta)
			cell["slope"] = clampf(float(cell.get("slope", 0.0)) + delta * 1.5, 0.0, 1.0)
			_set_feature(cell, feature)
			affected += 1
	return affected

static func _cold(cell: Dictionary) -> bool:
	return not bool(cell.get("water", false)) and not bool(cell.get("glaciated", false)) and float(cell.get("temperature", 1.0)) < 0.25
static func _polygonal(cell: Dictionary, seed: int) -> bool:
	var gx := int(cell.gx)
	var gy := int(cell.gy)
	var edge := absi(posmod(gx, 3) - 1) + absi(posmod(gy, 3) - 1)
	return edge >= 1 and RNG.unit_at(seed, floori(float(gx) / 3.0), floori(float(gy) / 3.0), 1301) < 0.72
static func _add_elevation(cell: Dictionary, delta: float) -> void:
	var base := float(cell.get("elevation_base", cell.get("elevation", 0.0)))
	cell["elevation_base"] = base + delta
	cell["elevation"] = float(cell.get("elevation", base)) + delta
	cell["bedrock_elevation"] = float(cell.get("bedrock_elevation", base)) + delta
static func _set_feature(cell: Dictionary, feature: int) -> void:
	cell["periglacial_feature"] = maxi(int(cell.get("periglacial_feature", 0)), feature)
static func _cells(region: Dictionary) -> Array:
	var input: Variant = region.get("cells", [])
	return (input as Dictionary).values() if input is Dictionary else input as Array
