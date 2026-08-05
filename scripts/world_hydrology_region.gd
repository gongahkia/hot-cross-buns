class_name WorldHydrologyRegion
extends RefCounted

const D8 = preload("res://scripts/world_d8_routing.gd")
const FLOW = preload("res://scripts/world_flow_accumulation.gd")

static func solve(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var scale_factor := float(options.get("scale_factor", region.get("scale_factor", 1.0)))
	var scale_id := str(options.get("scale_id", region.get("scale", "local")))
	var routing := D8.route(region, {"scale_factor": scale_factor})
	FLOW.seed_from_rainfall(region)
	for cell: Dictionary in _cells(region):
		cell["flow"] = float(cell.get("flow", 0.0)) + maxf(0.0, float(cell.get("basin_flow", 0.0)))
	var accumulation := FLOW.accumulate(routing.visit_order, {"loss": float(options.get("flow_loss", 0.965))})
	for cell: Dictionary in routing.visit_order:
		var down_cell: Variant = cell.get("down_cell", null)
		var hydro_slope := 0.0
		if down_cell is Dictionary:
			var down: Dictionary = down_cell
			var distance := maxf(1.0, float(cell.get("down_distance", scale_factor)))
			var filled_fall := maxf(0.0, float(cell.get("filled_elevation", 0.0)) - float(down.get("filled_elevation", 0.0)))
			var base_fall := maxf(0.0, float(cell.get("elevation_base", cell.get("elevation", 0.0))) - float(down.get("elevation_base", down.get("elevation", 0.0))))
			hydro_slope = maxf(filled_fall, base_fall * 0.25) / distance
		cell["hydro_slope"] = hydro_slope
		cell["slope"] = clampf(maxf(float(cell.get("slope", 0.0)), hydro_slope), 0.0, 1.0)
	var result := {"routing": routing, "accumulation": accumulation, "river_threshold": river_threshold(scale_id), "scale_id": scale_id}
	region["hydrology"] = result
	return result

static func river_threshold(scale_id: String) -> float:
	if scale_id == "local":
		return 82.0
	if scale_id == "region":
		return 46.0
	return 24.0

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []
