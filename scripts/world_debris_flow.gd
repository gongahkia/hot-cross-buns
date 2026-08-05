class_name WorldDebrisFlow
extends RefCounted

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var order: Array = region.get("visit_order", (region.get("cells", {}) as Dictionary).values())
	var critical := float(options.get("critical_concentration", 0.4))
	var debris_k := float(options.get("debris_k", 5e-4))
	var beta := float(options.get("beta", 2.0))
	var init_slope := float(options.get("init_slope", 0.3))
	var deposit_slope := float(options.get("deposit_slope", 0.1))
	var dt := float(options.get("dt", 1.0))
	var max_deposit := float(options.get("max_deposit", 0.08))
	for cell: Dictionary in order:
		cell["sediment_flux"] = float(cell.get("sediment_flux", 0.0))
		cell["debris_flow"] = false
		cell["debris_flow_delta"] = 0.0
	var active := 0
	for index in range(order.size() - 1, -1, -1):
		var cell: Dictionary = order[index]
		var down_cell: Variant = cell.get("down_cell", null)
		if not (down_cell is Dictionary) or bool(cell.get("water", false)):
			continue
		var down: Dictionary = down_cell
		var flow := maxf(1.0, float(cell.get("flow", 1.0)))
		var flux := maxf(0.0, float(cell.get("sediment_flux", 0.0)))
		var concentration := flux / flow
		if concentration <= critical:
			continue
		var distance := maxf(1.0, float(cell.get("down_distance", region.get("stride", 1.0))))
		var old := float(cell.get("elevation", cell.get("elevation_base", 0.0)))
		var slope := maxf(0.0, (old - float(down.get("elevation", down.get("elevation_base", old)))) / distance)
		var incision := minf(debris_k * flow * pow(slope, beta) * dt * float(cell.get("erodibility_k", 1.0)), maxf(0.0, 0.5 * distance * slope))
		var equilibrium := 0.0 if slope <= deposit_slope else critical * (slope - deposit_slope) / maxf(0.000001, init_slope - deposit_slope)
		var deposit := clampf((flux - equilibrium * flow) / maxf(1.0, float(options.get("deposit_length", 10.0 * distance))) * dt, 0.0, max_deposit) if concentration > equilibrium else 0.0
		cell["elevation"] = old - incision + deposit
		cell["debris_flow"] = true
		cell["debris_flow_delta"] = deposit - incision
		down["sediment_flux"] = float(down.get("sediment_flux", 0.0)) + maxf(0.0, flux - deposit * distance * distance + incision * flow * float(options.get("sediment_yield", 1.0))) * float(options.get("transfer", 0.985))
		active += 1
	return {"cells": order.size(), "debris_flow_cells": active}
