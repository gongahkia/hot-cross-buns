class_name WorldHillslope
extends RefCounted

static func face_flux(slope: float, diffusivity: float, critical_slope: float) -> Dictionary:
	var ratio := clampf(absf(slope) / maxf(0.000001, critical_slope), 0.0, 0.99)
	return {"flux": -diffusivity * slope / maxf(0.000001, 1.0 - ratio * ratio), "ratio": ratio}

static func diffuse(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var dt := float(options.get("dt", 0.0))
	var iterations := maxi(0, int(options.get("iterations", 1)))
	var cells := _ordered_cells(region)
	var result := {"moved": 0.0, "cells": cells.size(), "max_slope_ratio": 0.0, "transition_faces": 0}
	for cell: Dictionary in cells:
		cell["hillslope_delta"] = 0.0
		_sync_surface(cell)
	if dt <= 0.0 or iterations <= 0:
		_recompute_stream_power_slope(region, cells)
		region["hillslope"] = result
		return result
	var dt_years := dt * float(options.get("dt_years_scale", 1000.0))
	var distance := maxf(1.0, float(region.get("stride", 1.0)))
	var grid: Dictionary = region.get("cells", {})
	for _iteration in range(iterations):
		for cell: Dictionary in cells:
			_transfer(cell, grid.get(_key(int(cell.gx) + 1, int(cell.gy)), {}), distance, options, dt_years, result)
			_transfer(cell, grid.get(_key(int(cell.gx), int(cell.gy) + 1), {}), distance, options, dt_years, result)
		for cell: Dictionary in cells:
			_sync_surface(cell)
	_recompute_stream_power_slope(region, cells)
	region["hillslope"] = result
	return result

static func _transfer(a: Dictionary, b: Dictionary, distance: float, options: Dictionary, dt_years: float, result: Dictionary) -> void:
	if b.is_empty():
		return
	var slope := (_surface(b) - _surface(a)) / distance
	var base_d := float(options.get("d", 0.005))
	var diffusivity := ((base_d if float(a.get("regolith_depth", 0.0)) > 0.0 else base_d * 0.1) + (base_d if float(b.get("regolith_depth", 0.0)) > 0.0 else base_d * 0.1)) * 0.5
	var critical_slope := float(options.get("sc", 1.2))
	if int(a.get("lithology", 0)) == 7 or int(b.get("lithology", 0)) == 7:
		critical_slope = minf(critical_slope, 0.8)
	var face := face_flux(slope, diffusivity, critical_slope)
	var amount := absf(float(face.flux)) * dt_years / distance
	if amount <= 0.0:
		return
	var source := b if float(face.flux) < 0.0 else a
	var destination := a if float(face.flux) < 0.0 else b
	amount = minf(amount, maxf(0.0, float(source.get("regolith_depth", 0.0))))
	if amount <= 0.0:
		return
	source["regolith_depth"] = float(source.regolith_depth) - amount
	destination["regolith_depth"] = float(destination.regolith_depth) + amount
	source["hillslope_delta"] = float(source.hillslope_delta) - amount
	destination["hillslope_delta"] = float(destination.hillslope_delta) + amount
	result["moved"] = float(result.moved) + amount
	result["max_slope_ratio"] = maxf(float(result.max_slope_ratio), float(face.ratio))
	if float(face.ratio) >= 0.54 and float(face.ratio) <= 0.66:
		result["transition_faces"] = int(result.transition_faces) + 1

static func _sync_surface(cell: Dictionary) -> void:
	var regolith := maxf(0.0, float(cell.get("regolith_depth", 0.0)))
	cell["regolith_depth"] = regolith
	cell["bedrock_elevation"] = float(cell.get("bedrock_elevation", _surface(cell) - regolith))
	cell["elevation"] = float(cell.bedrock_elevation) + regolith

static func _recompute_stream_power_slope(region: Dictionary, cells: Array) -> void:
	for cell: Dictionary in cells:
		var down_cell: Variant = cell.get("down_cell", null)
		cell["stream_power_slope"] = maxf(0.0, (_surface(cell) - _surface(down_cell as Dictionary)) / maxf(1.0, float(cell.get("down_distance", region.get("stride", 1.0))))) if down_cell is Dictionary else 0.0

static func _surface(cell: Dictionary) -> float:
	return float(cell.get("elevation", cell.get("elevation_base", 0.0)))

static func _ordered_cells(region: Dictionary) -> Array:
	var cells: Array = (region.get("cells", {}) as Dictionary).values()
	cells.sort_custom(func(left: Dictionary, right: Dictionary): return int(left.get("gy", 0)) < int(right.get("gy", 0)) or (int(left.get("gy", 0)) == int(right.get("gy", 0)) and int(left.get("gx", 0)) < int(right.get("gx", 0))))
	return cells

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
