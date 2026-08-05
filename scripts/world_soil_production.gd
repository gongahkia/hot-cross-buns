class_name WorldSoilProduction
extends RefCounted

static func steady_state_depth(erosion_rate: float, options: Dictionary = {}) -> float:
	var p0 := float(options.get("p0", 1.5e-4))
	var h_star := float(options.get("h_star", 0.5))
	erosion_rate = maxf(0.0, erosion_rate)
	if erosion_rate <= 0.0:
		return h_star
	if erosion_rate >= p0:
		return 0.0
	return h_star * log(p0 / erosion_rate)

static func sync_cell(cell: Dictionary) -> Dictionary:
	var elevation := float(cell.get("elevation", cell.get("elevation_base", 0.0)))
	var regolith := maxf(0.0, float(cell.get("regolith_depth", 0.0)))
	cell["regolith_depth"] = regolith
	cell["bedrock_elevation"] = elevation - regolith
	return cell

static func sync_region(region: Dictionary) -> void:
	for cell: Dictionary in _cells(region):
		sync_cell(cell)

static func step(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var dt := float(options.get("dt", 0.0))
	if dt <= 0.0:
		sync_region(region)
		return {"produced": 0.0, "cells": 0, "max_depth": 0.0}
	var p0 := float(options.get("p0", 1.5e-4))
	var h_star := float(options.get("h_star", 0.5))
	var bulk := float(options.get("bulking_ratio", 1.5))
	var dt_years := dt * float(options.get("dt_years_scale", 1000.0))
	var slope_scale := float(options.get("slope_erosion_scale", 4e-4))
	var base_erosion := float(options.get("base_erosion_rate", 4e-5))
	var produced := 0.0
	var cells := 0
	var max_depth := 0.0
	for cell: Dictionary in _cells(region):
		var elevation := float(cell.get("elevation", cell.get("elevation_base", 0.0)))
		var current := maxf(0.0, float(cell.get("regolith_depth", 0.0)))
		var erosion_rate := float(cell.get("soil_erosion_rate", base_erosion + clampf(float(cell.get("slope", 0.0)), 0.0, 1.0) * slope_scale))
		var target := steady_state_depth(erosion_rate, {"p0": p0, "h_star": h_star})
		var production := p0 * exp(-current / h_star) * dt_years * bulk
		var next_depth := clampf(minf(target, current + production), 0.0, maxf(target, current))
		cell["regolith_depth"] = next_depth
		cell["bedrock_elevation"] = elevation - next_depth
		produced += maxf(0.0, next_depth - current)
		cells += 1
		max_depth = maxf(max_depth, next_depth)
	return {"produced": produced, "cells": cells, "max_depth": max_depth}

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []
