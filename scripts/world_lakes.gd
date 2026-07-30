class_name WorldLakes
extends RefCounted

const NEIGHBORS := [{"x": -1, "y": -1}, {"x": 0, "y": -1}, {"x": 1, "y": -1}, {"x": -1, "y": 0}, {"x": 1, "y": 0}, {"x": -1, "y": 1}, {"x": 0, "y": 1}, {"x": 1, "y": 1}]

static func apply(region: Dictionary, options: Dictionary = {}) -> Array:
	mark_candidates(region, options)
	var groups := group_and_route(region, options)
	region["lake_groups"] = groups
	return groups

static func mark_candidates(region: Dictionary, options: Dictionary = {}) -> void:
	var sea_level := float(options.get("sea_level", 0.0))
	var min_depth := float(options.get("min_depth", 0.018))
	for cell: Dictionary in _cells(region):
		var elevation := float(cell.get("elevation_base", cell.get("elevation", 0.0)))
		var filled := float(cell.get("filled_elevation", elevation))
		var ocean := elevation <= sea_level
		var lake_depth := maxf(0.0, filled - elevation)
		var lake := not ocean and lake_depth > min_depth and filled > sea_level + 0.006
		if bool(cell.get("cenote", false)) and not ocean:
			lake_depth = maxf(lake_depth, 0.012)
			lake = true
		cell["lake_depth"] = lake_depth
		cell["lake"] = lake
		cell.erase("lake_surface")
		if lake:
			cell["lake_surface"] = maxf(filled, elevation + lake_depth)
		cell["water"] = ocean or lake

static func group_and_route(region: Dictionary, options: Dictionary = {}) -> Array:
	var scale_id := str(options.get("scale_id", region.get("scale", "local")))
	var cells: Dictionary = region.get("cells", {})
	var groups: Array = []
	var seen := {}
	for start: Dictionary in _cells(region):
		var start_key := _key(int(start.get("gx", 0)), int(start.get("gy", 0)))
		if not bool(start.get("lake", false)) or seen.has(start_key):
			continue
		var stack: Array = [start]
		var lake_cells: Array = []
		var outlet: Dictionary = {}
		var surface := float(start.get("lake_surface", start.get("filled_elevation", 0.0)))
		var max_depth := 0.0
		var max_flow := 0.0
		seen[start_key] = true
		while not stack.is_empty():
			var cell: Dictionary = stack.pop_back()
			lake_cells.append(cell)
			surface = maxf(surface, float(cell.get("lake_surface", cell.get("filled_elevation", 0.0))))
			max_depth = maxf(max_depth, float(cell.get("lake_depth", 0.0)))
			max_flow = maxf(max_flow, float(cell.get("flow", 0.0)))
			var candidate := _lake_outlet(cell)
			if not candidate.is_empty() and (outlet.is_empty() or float(candidate.get("filled_elevation", candidate.get("elevation_base", 0.0))) < float(outlet.get("filled_elevation", outlet.get("elevation_base", 0.0)))):
				outlet = candidate
			for offset: Dictionary in NEIGHBORS:
				var neighbor: Dictionary = cells.get(_key(int(cell.gx) + int(offset.x), int(cell.gy) + int(offset.y)), {})
				var neighbor_key := _key(int(neighbor.get("gx", 0)), int(neighbor.get("gy", 0)))
				if not neighbor.is_empty() and bool(neighbor.get("lake", false)) and not seen.has(neighbor_key):
					seen[neighbor_key] = true
					stack.append(neighbor)
		var anchor: Dictionary = outlet if not outlet.is_empty() else lake_cells[0]
		var group_id := "lg:%s:%d:%d:%d" % [scale_id, roundi(surface * 10000.0), int(anchor.gx), int(anchor.gy)]
		var group := {"id": group_id, "cells": lake_cells, "outlet": outlet, "surface": surface, "max_depth": max_depth, "max_flow": max_flow}
		groups.append(group)
		for cell: Dictionary in lake_cells:
			cell["lake_id"] = group_id
			cell["lake_group_size"] = lake_cells.size()
			cell["lake_max_depth"] = max_depth
			cell["spillover_elevation"] = surface
			cell["spillover_flow"] = max_flow
			if not outlet.is_empty():
				cell["outlet_gx"] = int(outlet.gx)
				cell["outlet_gy"] = int(outlet.gy)
		if not outlet.is_empty():
			outlet["spillover"] = true
			outlet["spillover_lake_id"] = group_id
			outlet["spillover_elevation"] = surface
			outlet["spillover_flow"] = maxf(float(outlet.get("spillover_flow", 0.0)), max_flow)
	return groups

static func _lake_outlet(cell: Dictionary) -> Dictionary:
	if cell.has("lake_outlet_cell"):
		var cached: Variant = cell.get("lake_outlet_cell", null)
		return cached if cached is Dictionary else {}
	var path: Array = [cell]
	var cursor: Variant = cell.get("down_cell", null)
	while cursor is Dictionary and bool((cursor as Dictionary).get("lake", false)):
		path.append(cursor)
		cursor = (cursor as Dictionary).get("down_cell", null)
	var outlet: Dictionary = cursor if cursor is Dictionary else {}
	for item: Dictionary in path:
		item["lake_outlet_cell"] = outlet
	return outlet

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
