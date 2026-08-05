class_name WorldCoarseBasin
extends RefCounted

const D8 = preload("res://scripts/world_d8_routing.gd")
const FLOW = preload("res://scripts/world_flow_accumulation.gd")
const SOIL = preload("res://scripts/world_soil_production.gd")

static func solve(sample_cell: Callable, chunk_x: int, chunk_y: int, options: Dictionary = {}) -> Dictionary:
	var basin_chunks := int(options.get("basin_chunks", 0))
	var stride := maxi(1, int(options.get("stride", 1)))
	if basin_chunks <= 0 or stride <= 1:
		return {}
	var chunk_size := int(options.get("chunk_size", 64))
	var halo := floori(float(int(options.get("halo_cells", 0))) / float(stride))
	var scale_id := str(options.get("scale_id", "local"))
	var scale_factor := float(options.get("scale_factor", 1.0))
	var sea_level := float(options.get("sea_level", 0.0))
	assert(chunk_size > 0 and scale_factor > 0.0, "coarse basin dimensions and scale factor must be positive")
	var region_x := region_index(chunk_x, basin_chunks)
	var region_y := region_index(chunk_y, basin_chunks)
	var start_chunk_x := region_start(region_x, basin_chunks)
	var start_chunk_y := region_start(region_y, basin_chunks)
	var interior_min_x := floori(float(start_chunk_x * chunk_size) / float(stride))
	var interior_min_y := floori(float(start_chunk_y * chunk_size) / float(stride))
	var interior_max_x := floori(float((start_chunk_x + basin_chunks) * chunk_size - 1) / float(stride))
	var interior_max_y := floori(float((start_chunk_y + basin_chunks) * chunk_size - 1) / float(stride))
	var region := {"id": "basin:%s:%d:%d" % [scale_id, region_x, region_y], "scale": scale_id, "scale_factor": scale_factor, "region_x": region_x, "region_y": region_y, "stride": stride, "threshold": river_threshold(scale_id, stride), "min_x": interior_min_x - halo, "min_y": interior_min_y - halo, "max_x": interior_max_x + halo, "max_y": interior_max_y + halo, "cells": {}}
	for gy in range(int(region.min_y), int(region.max_y) + 1):
		for gx in range(int(region.min_x), int(region.max_x) + 1):
			var sample_x := float(gx * stride) + float(stride - 1) * 0.5
			var sample_y := float(gy * stride) + float(stride - 1) * 0.5
			var cell: Dictionary = sample_cell.call(sample_x * scale_factor, sample_y * scale_factor, scale_id)
			cell["gx"] = gx
			cell["gy"] = gy
			cell["filled_elevation"] = float(cell.get("elevation_base", cell.get("elevation", 0.0)))
			cell["water"] = float(cell.get("elevation_base", cell.get("elevation", 0.0))) <= sea_level
			cell["river"] = false
			region.cells[_key(gx, gy)] = cell
	FLOW.seed_from_rainfall(region, stride)
	region["soil_production"] = SOIL.step(region, {"dt": float(options.get("geologic_time_step", 0.0))})
	var routing := D8.route(region, {"stride": stride, "scale_factor": scale_factor})
	var accumulation := FLOW.accumulate(routing.visit_order, {"loss": 0.985})
	var basin_ids := {}
	var rivers := 0
	for cell: Dictionary in routing.visit_order:
		var root := _terminal(cell)
		var basin_id := "mb:%s:%d:%d" % [scale_id, int(root.gx), int(root.gy)]
		cell["basin_id"] = basin_id
		basin_ids[basin_id] = true
		cell["river"] = not bool(cell.get("water", false)) and cell.has("down_cell") and float(cell.get("flow", 0.0)) > float(region.threshold)
		if cell.has("down_cell"):
			var down: Dictionary = cell.down_cell
			cell["channel_id"] = "mc:%s:%d:%d:%d:%d" % [scale_id, int(cell.gx), int(cell.gy), int(down.gx), int(down.gy)]
		if bool(cell.river):
			rivers += 1
	region["sea_level"] = sea_level
	region["routing"] = routing
	region["accumulation"] = accumulation
	region["stats"] = {"rivers": rivers, "basins": basin_ids.size(), "max_flow": float(accumulation.max_flow)}
	return region

static func flow_for(region: Dictionary, gx: int, gy: int, options: Dictionary = {}) -> Dictionary:
	var stride := maxi(1, int(region.get("stride", 1)))
	var cell: Dictionary = (region.get("cells", {}) as Dictionary).get(_key(floori(float(gx) / float(stride)), floori(float(gy) / float(stride))), {})
	if cell.is_empty() or not bool(cell.get("river", false)) or not cell.has("down_cell"):
		return {"flow": 0.0, "cell": cell, "weight": 0.0}
	var down: Dictionary = cell.down_cell
	var ax := float(cell.gx * stride) + float(stride - 1) * 0.5
	var ay := float(cell.gy * stride) + float(stride - 1) * 0.5
	var bx := float(down.gx * stride) + float(stride - 1) * 0.5
	var by := float(down.gy * stride) + float(stride - 1) * 0.5
	var width := clampf(float(stride) * 0.28, 0.75, 2.25)
	var weight := clampf(1.0 - _point_segment_distance(float(gx), float(gy), ax, ay, bx, by) / width, 0.0, 1.0)
	var flow := maxf(0.0, float(cell.get("flow", 0.0)) - float(region.get("threshold", 0.0))) / maxf(1.0, float(stride * stride))
	return {"flow": flow * float(options.get("flow_scale", 0.6)) * weight, "cell": cell, "weight": weight}

static func region_index(chunk_coordinate: int, basin_chunks: int) -> int:
	assert(basin_chunks > 0, "coarse basin chunk count must be positive")
	return floori(float(chunk_coordinate + floori(float(basin_chunks) / 2.0)) / float(basin_chunks))

static func region_start(region_coordinate: int, basin_chunks: int) -> int:
	assert(basin_chunks > 0, "coarse basin chunk count must be positive")
	return region_coordinate * basin_chunks - floori(float(basin_chunks) / 2.0)

static func river_threshold(scale_id: String, stride: int) -> float:
	var base := 24.0
	if scale_id == "local":
		base = 82.0
	elif scale_id == "region":
		base = 46.0
	return base * maxf(1.0, float(stride * stride) * 0.18)

static func _terminal(cell: Dictionary) -> Dictionary:
	var path: Array = []
	var cursor := cell
	while cursor.has("down_cell"):
		path.append(cursor)
		cursor = cursor.down_cell
	for item: Dictionary in path:
		item["terminal_cell"] = cursor
	return cursor

static func _point_segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
	var vx := bx - ax
	var vy := by - ay
	var length_squared := vx * vx + vy * vy
	if length_squared <= 0.0:
		return Vector2(px - ax, py - ay).length()
	var t := clampf(((px - ax) * vx + (py - ay) * vy) / length_squared, 0.0, 1.0)
	return Vector2(px - (ax + vx * t), py - (ay + vy * t)).length()

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
