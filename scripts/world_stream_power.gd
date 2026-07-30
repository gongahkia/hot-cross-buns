class_name WorldStreamPower
extends RefCounted

const SOIL = preload("res://scripts/world_soil_production.gd")

static func relax(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var order := _ordered_cells(region)
	var iterations := maxi(0, int(options.get("iterations", 80)))
	var k := float(options.get("k", 0.0006))
	var m := float(options.get("m", 0.5))
	var n := float(options.get("n", 1.0))
	var dt := float(options.get("dt", 1.0))
	var min_slope := float(options.get("min_slope", 0.00002))
	var sea_level := float(region.get("sea_level", -INF))
	for cell: Dictionary in order:
		cell["elevation_base"] = float(cell.get("elevation_base", cell.get("elevation", 0.0)))
		cell["elevation"] = float(cell.get("elevation", cell.get("elevation_base", 0.0)))
	var max_delta := 0.0
	for _iteration in range(iterations):
		max_delta = 0.0
		for index in range(order.size() - 1, -1, -1):
			var cell: Dictionary = order[index]
			var down_cell: Variant = cell.get("down_cell", null)
			if not (down_cell is Dictionary) or bool(cell.get("water", false)):
				continue
			var down: Dictionary = down_cell
			var old := float(cell.get("elevation", cell.get("elevation_base", 0.0)))
			var down_elevation := float(down.get("elevation", down.get("elevation_base", old)))
			var distance := maxf(1.0, float(cell.get("down_distance", region.get("stride", 1.0))))
			var slope := maxf(0.0, (old - down_elevation) / distance)
			var area := maxf(0.01, float(cell.get("flow", 0.01)))
			var incision := k * pow(area, m) * pow(maxf(slope, min_slope), n) * dt * float(cell.get("erodibility_k", 1.0))
			incision = minf(incision, maxf(0.0, 0.5 * distance * slope))
			var uplift := _uplift(cell, options.get("uplift", "plate_based")) * dt
			var next_elevation := old + uplift - incision
			var grade_floor := down_elevation + min_slope * distance
			if old >= grade_floor:
				next_elevation = maxf(next_elevation, grade_floor)
			next_elevation = minf(next_elevation, old + uplift)
			next_elevation = maxf(next_elevation, sea_level - 0.08)
			max_delta = maxf(max_delta, absf(next_elevation - old))
			cell["elevation"] = next_elevation
	var erosion_sum := 0.0
	var uplift_sum := 0.0
	var max_erosion := 0.0
	for cell: Dictionary in order:
		var delta := float(cell.elevation) - float(cell.elevation_base)
		var erosion := maxf(0.0, -delta)
		var uplift := maxf(0.0, delta)
		cell["stream_power_delta"] = delta
		cell["stream_power_erosion"] = erosion
		cell["stream_power_uplift"] = uplift
		var down_cell: Variant = cell.get("down_cell", null)
		if down_cell is Dictionary:
			var down_elevation := float((down_cell as Dictionary).get("elevation", (down_cell as Dictionary).get("elevation_base", cell.elevation)))
			var distance := maxf(1.0, float(cell.get("down_distance", region.get("stride", 1.0))))
			cell["stream_power_slope"] = maxf(0.0, (float(cell.elevation) - down_elevation) / distance)
		else:
			cell["stream_power_slope"] = 0.0
		SOIL.sync_cell(cell)
		erosion_sum += erosion
		uplift_sum += uplift
		max_erosion = maxf(max_erosion, erosion)
	var sediment_sum := _route_sediment(order, options)
	return {"iterations": iterations, "max_delta": max_delta, "mean_erosion": erosion_sum / maxf(1.0, float(order.size())), "mean_uplift": uplift_sum / maxf(1.0, float(order.size())), "max_erosion": max_erosion, "mean_sediment": sediment_sum.mean, "max_sediment": sediment_sum.max}

static func _route_sediment(order: Array, options: Dictionary) -> Dictionary:
	var yield_scale := float(options.get("sediment_yield", 1.0))
	var capacity_scale := float(options.get("sediment_capacity", 0.18))
	var deposition_g := float(options.get("g", 1.2))
	var transfer := float(options.get("sediment_transfer", 0.985))
	var max_deposit := float(options.get("max_deposit", 0.06))
	for cell: Dictionary in order:
		cell["sediment"] = 0.0
		cell["sediment_flux"] = 0.0
		cell["sediment_capacity"] = 0.0
	var total := 0.0
	var maximum := 0.0
	for index in range(order.size() - 1, -1, -1):
		var cell: Dictionary = order[index]
		if bool(cell.get("water", false)):
			continue
		var flow := maxf(1.0, float(cell.get("flow", 1.0)))
		var flux := float(cell.get("sediment_flux", 0.0)) + float(cell.get("stream_power_erosion", 0.0)) * flow * yield_scale
		var capacity := capacity_scale * flow * maxf(0.0001, float(cell.get("stream_power_slope", 0.0)))
		var deposit := 0.0
		if flux > capacity:
			deposit = minf(minf(flux - capacity, deposition_g * flux / flow), max_deposit)
			flux -= deposit
		cell["sediment"] = deposit
		cell["sediment_flux"] = flux
		cell["sediment_capacity"] = capacity
		total += deposit
		maximum = maxf(maximum, deposit)
		var down_cell: Variant = cell.get("down_cell", null)
		if down_cell is Dictionary:
			(down_cell as Dictionary)["sediment_flux"] = float((down_cell as Dictionary).get("sediment_flux", 0.0)) + flux * transfer
	return {"mean": total / maxf(1.0, float(order.size())), "max": maximum}

static func _uplift(cell: Dictionary, mode: Variant) -> float:
	if mode is float or mode is int:
		return float(mode)
	if mode is bool and not bool(mode):
		return 0.0
	var uplift := maxf(0.0, float(cell.get("uplift", 0.0)))
	var boundary := maxf(0.0, float(cell.get("plate_boundary", 0.0)))
	return uplift * 0.00018 + uplift * boundary * 0.00022

static func _ordered_cells(region: Dictionary) -> Array:
	var order: Array = region.get("visit_order", [])
	if not order.is_empty():
		return order
	var cells: Array = (region.get("cells", {}) as Dictionary).values() if region.get("cells", {}) is Dictionary else region.get("cells", [])
	cells.sort_custom(func(left: Dictionary, right: Dictionary): return float(left.get("filled_elevation", left.get("elevation", left.get("elevation_base", 0.0)))) < float(right.get("filled_elevation", right.get("elevation", right.get("elevation_base", 0.0)))))
	return cells
