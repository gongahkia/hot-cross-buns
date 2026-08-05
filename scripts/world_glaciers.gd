class_name WorldGlaciers
extends RefCounted

const SOIL = preload("res://scripts/world_soil_production.gd")

static func glaciate(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var order: Array = region.get("visit_order", (region.get("cells", {}) as Dictionary).values())
	var freeze := float(options.get("freeze_temperature", 0.38))
	var sea_level := float(options.get("sea_level", region.get("sea_level", -INF)))
	var min_ice := float(options.get("min_ice_thickness", 0.0005))
	var dt := float(options.get("dt", maxf(1.0, float(options.get("geologic_time_step", 0.0)) * 20.0)))
	var iterations := maxi(1, int(options.get("sia_iterations", 3)))
	var dx := maxf(0.000001, float(options.get("dx", maxf(1.0, float(region.get("stride", 1.0))) * maxf(1.0, float(region.get("scale_factor", 1.0))))))
	var gamma := float(options.get("normalized_gamma", options.get("gamma", 4.4e-9) * 8e11))
	var accumulation := float(options.get("normalized_beta", options.get("beta", 0.008) * 80.0))
	var ablation := float(options.get("ablation_max", 0.12))
	var state: Dictionary = options.get("ice_state", {})
	var ice: Dictionary = {}
	var bed: Dictionary = {}
	var velocity: Dictionary = {}
	var slope_max: Dictionary = {}
	var grid: Dictionary = region.get("cells", {})
	for cell: Dictionary in order:
		var key := _key(cell)
		bed[key] = float(cell.get("bedrock_elevation", cell.get("elevation_base", cell.get("elevation", 0.0)) - maxf(0.0, float(cell.get("regolith_depth", 0.0)))))
		ice[key] = 0.0 if bool(cell.get("water", false)) or float(bed[key]) <= sea_level else maxf(0.0, float(state.get(key, cell.get("ice_thickness", _initial_ice(cell, float(bed[key]), freeze)))))
		velocity[key] = 0.0
		slope_max[key] = 0.0
		cell["glaciated"] = false
		cell["glacial_delta"] = 0.0
		cell["glacial_erosion"] = 0.0
	for _iteration in range(iterations):
		var delta := {}
		for cell: Dictionary in order:
			var key := _key(cell)
			delta[key] = _smb(cell, float(bed[key]) + float(ice[key]), freeze, sea_level, accumulation, ablation) * dt / float(iterations)
		for cell: Dictionary in order:
			var key := _key(cell)
			for offset: Vector2i in [Vector2i(1, 0), Vector2i(0, 1)]:
				var neighbor: Dictionary = grid.get("%d:%d" % [int(cell.gx) + offset.x, int(cell.gy) + offset.y], {})
				if neighbor.is_empty(): continue
				var neighbor_key := _key(neighbor)
				var h := (float(ice[key]) + float(ice[neighbor_key])) * 0.5
				if h <= min_ice: continue
				var slope := (float(bed[neighbor_key]) + float(ice[neighbor_key]) - float(bed[key]) - float(ice[key])) / dx
				var flux := -gamma * pow(h, 5.0) * pow(absf(slope), 2.0) * slope
				var source_key := key if flux >= 0.0 else neighbor_key
				flux = clampf(flux, -float(ice[source_key]) * 0.45 * dx / maxf(dt / float(iterations), 0.000001), float(ice[source_key]) * 0.45 * dx / maxf(dt / float(iterations), 0.000001))
				var transfer := flux * (dt / float(iterations)) / dx
				delta[key] = float(delta[key]) - transfer
				delta[neighbor_key] = float(delta[neighbor_key]) + transfer
				var speed := 0.5 * absf(flux) / maxf(h, min_ice)
				velocity[key] = maxf(float(velocity[key]), speed)
				velocity[neighbor_key] = maxf(float(velocity[neighbor_key]), speed)
				slope_max[key] = maxf(float(slope_max[key]), absf(slope))
				slope_max[neighbor_key] = maxf(float(slope_max[neighbor_key]), absf(slope))
		for cell: Dictionary in order:
			var key := _key(cell)
			ice[key] = 0.0 if bool(cell.get("water", false)) or float(bed[key]) <= sea_level else maxf(0.0, float(ice[key]) + float(delta[key]))
	var count := 0
	var erosion := 0.0
	var volume := 0.0
	var next_state := {}
	for cell: Dictionary in order:
		var key := _key(cell)
		var h := float(ice[key])
		var glaciated := h > min_ice and _accumulates(cell, float(bed[key]), freeze)
		var cut := minf(float(options.get("max_cut", 0.075)), float(options.get("kg", 5e-5)) * float(options.get("erosion_scale", 1600.0)) * pow(float(velocity[key]), 2.0) * dt + minf(float(options.get("max_cut", 0.075)) * 0.35, h * minf(1.0, float(slope_max[key])) * 0.08)) if h > min_ice and not bool(cell.get("water", false)) else 0.0
		cell["elevation"] = float(cell.get("elevation", cell.get("elevation_base", 0.0))) - cut
		cell["glacial_delta"] = -cut
		cell["glacial_erosion"] = cut
		cell["ice_thickness"] = h
		cell["glaciated"] = glaciated
		SOIL.sync_cell(cell)
		count += 1 if glaciated else 0
		erosion += cut
		volume += h
		next_state[key] = h
	var result := {"glaciated_cells": count, "mean_glacial_erosion": erosion / maxf(1.0, float(order.size())), "ice_volume": volume, "ice_state": next_state}
	region["glaciers"] = result
	return result

static func _initial_ice(cell: Dictionary, bed: float, freeze: float) -> float:
	if not _accumulates(cell, bed, freeze): return 0.0
	return 0.06 * pow(maxf(0.0, bed - 0.55) / 0.45, 0.375)
static func _accumulates(cell: Dictionary, bed: float, freeze: float) -> bool:
	return not bool(cell.get("water", false)) and float(cell.get("temperature", 1.0)) < freeze and bed > 0.55
static func _smb(cell: Dictionary, surface: float, freeze: float, sea_level: float, accumulation: float, ablation: float) -> float:
	if bool(cell.get("water", false)) or surface <= sea_level: return -ablation
	if float(cell.get("temperature", 1.0)) >= freeze: return -ablation
	return clampf(accumulation * (surface - 0.55), -ablation, minf(0.18, 2.0 * 0.08))
static func _key(cell: Dictionary) -> String:
	return "%d:%d" % [int(cell.get("gx", 0)), int(cell.get("gy", 0))]
