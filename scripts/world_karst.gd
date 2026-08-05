class_name WorldKarst
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var seed := int(options.get("seed", region.get("seed", 1)))
	var sea_level := float(options.get("sea_level", region.get("sea_level", 0.0)))
	var stride := maxf(1.0, float(options.get("stride", region.get("stride", 1.0))))
	var density := float(options.get("density", 0.04))
	var candidates: Array = []
	var carbonate_cells := 0
	for cell: Dictionary in _cells(region):
		cell["karst_depth"] = 0.0; cell["cave_presence"] = 0.0; cell["karst_type"] = 0; cell["sinkhole"] = false; cell["cenote"] = false
		if int(cell.get("lithology", 0)) != 4: continue
		carbonate_cells += 1
		var gx := int(cell.gx); var gy := int(cell.gy)
		cell["cave_presence"] = 0.2 + RNG.unit_at(seed, gx, gy, 1049) * 0.4
		var climate := clampf(float(cell.get("rainfall", cell.get("precipitation", 0.0))) * (1.0 - _latitude(cell) * 0.5), 0.0, 1.0)
		if RNG.unit_at(seed, gx, gy, 1009) < density * climate: candidates.append(cell)
	candidates.sort_custom(func(a: Dictionary, b: Dictionary): return RNG.thoth_hash(seed, int(a.gx), int(a.gy), 1019) < RNG.thoth_hash(seed, int(b.gx), int(b.gy), 1019))
	candidates = _prune(candidates, stride * 2.0)
	var stats := {"carbonate_cells": carbonate_cells, "candidates": candidates.size(), "features": 0, "dolines": 0, "poljes": 0, "towers": 0, "plains": 0, "sinkholes": 0, "cenotes": 0, "affected_cells": 0, "max_depth": 0.0}
	for center: Dictionary in candidates:
		var kind := int(options.get("force_kind", _kind(center, sea_level)))
		var radius := _radius(kind, seed, int(center.gx), int(center.gy), stride)
		var outcome := _stamp(region, center, kind, radius, _delta(kind, seed, int(center.gx), int(center.gy)))
		if int(outcome.affected) <= 0: continue
		stats["features"] = int(stats.features) + 1
		stats["affected_cells"] = int(stats.affected_cells) + int(outcome.affected)
		stats["sinkholes"] = int(stats.sinkholes) + int(outcome.sinkholes)
		stats["cenotes"] = int(stats.cenotes) + int(outcome.cenotes)
		if kind == 1: stats["dolines"] = int(stats.dolines) + 1
		elif kind == 2: stats["poljes"] = int(stats.poljes) + 1
		elif kind == 3: stats["towers"] = int(stats.towers) + 1
		else: stats["plains"] = int(stats.plains) + 1
	for cell: Dictionary in _cells(region): stats["max_depth"] = maxf(float(stats.max_depth), float(cell.get("karst_depth", 0.0)))
	region["karst"] = stats
	return stats

static func _stamp(region: Dictionary, center: Dictionary, kind: int, radius: float, base_delta: float) -> Dictionary:
	var affected := 0; var sinkholes := 0; var cenotes := 0
	var grid: Dictionary = region.get("cells", {})
	for gy in range(floori(float(center.gy) - radius), ceili(float(center.gy) + radius) + 1):
		for gx in range(floori(float(center.gx) - radius), ceili(float(center.gx) + radius) + 1):
			var cell: Dictionary = grid.get("%d:%d" % [gx, gy], {})
			if cell.is_empty() or int(cell.get("lithology", 0)) != 4: continue
			var t := Vector2(float(gx - int(center.gx)), float(gy - int(center.gy))).length() / radius
			if t > 1.0: continue
			var delta := base_delta * (1.0 + cos(PI * t)) * 0.5 if kind == 1 else base_delta * (1.0 - t) if kind == 3 else base_delta
			_apply_delta(cell, delta, kind)
			if kind == 1 and t <= 0.38:
				cell["sinkhole"] = true; sinkholes += 1
				if t <= 0.18 and float(cell.karst_depth) > 0.055 and float(cell.get("rainfall", cell.get("precipitation", 0.0))) > 0.22: cell["cenote"] = true; cenotes += 1
			affected += 1
	return {"affected": affected, "sinkholes": sinkholes, "cenotes": cenotes}
static func _apply_delta(cell: Dictionary, delta: float, kind: int) -> void:
	cell["karst_type"] = maxi(int(cell.get("karst_type", 0)), kind)
	if delta < 0.0: cell["karst_depth"] = maxf(float(cell.get("karst_depth", 0.0)), -delta)
	var base := float(cell.get("elevation_base", cell.get("elevation", 0.0)))
	cell["elevation_base"] = base + delta; cell["elevation"] = float(cell.get("elevation", base)) + delta; cell["bedrock_elevation"] = float(cell.get("bedrock_elevation", base)) + delta
static func _kind(cell: Dictionary, sea: float) -> int:
	var rain := float(cell.get("rainfall", cell.get("precipitation", 0.0))); var elevation := float(cell.get("elevation_base", cell.get("elevation", 0.0))); var slope := float(cell.get("slope", 0.0))
	if rain > 0.7 and _latitude(cell) < 0.35: return 3
	if elevation > sea + 0.2 and rain > 0.3: return 1
	return 2 if slope < 0.05 and elevation < 0.3 else 4
static func _radius(kind: int, seed: int, gx: int, gy: int, stride: float) -> float: return (1 + floori(RNG.unit_at(seed, gx, gy, 1021) * 2.0)) * stride if kind == 1 else (3 + floori(RNG.unit_at(seed, gx, gy, 1023) * 3.0)) * stride if kind == 2 else stride
static func _delta(kind: int, seed: int, gx: int, gy: int) -> float: return -(0.04 + RNG.unit_at(seed, gx, gy, 1031) * 0.06) if kind == 1 else -0.02 if kind == 2 else 0.18 if kind == 3 else 0.0
static func _latitude(cell: Dictionary) -> float: return absf(float(cell.get("latitude_radians", 0.0))) / (PI * 0.5)
static func _prune(candidates: Array, distance: float) -> Array:
	var kept: Array = []
	for candidate: Dictionary in candidates:
		var valid := true
		for other: Dictionary in kept: if Vector2(float(candidate.gx - other.gx), float(candidate.gy - other.gy)).length_squared() < distance * distance: valid = false; break
		if valid: kept.append(candidate)
	return kept
static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
