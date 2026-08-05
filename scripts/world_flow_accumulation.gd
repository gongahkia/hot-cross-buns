class_name WorldFlowAccumulation
extends RefCounted

static func seed_from_rainfall(region: Dictionary, stride: float = 1.0) -> Dictionary:
	assert(stride > 0.0, "flow-accumulation stride must be positive")
	var total := 0.0
	var cells := 0
	for cell: Dictionary in _cells(region):
		var rainfall := float(cell.get("rainfall", cell.get("precipitation", 0.0)))
		var flow := maxf(0.01, rainfall) * stride * stride
		cell["flow"] = flow
		total += flow
		cells += 1
	return {"cells": cells, "seeded_flow": total}

static func accumulate(visit_order: Array, options: Dictionary = {}) -> Dictionary:
	var loss := float(options.get("loss", 0.985))
	assert(loss >= 0.0 and loss <= 1.0, "flow-accumulation loss must be in [0, 1]")
	var transferred := 0.0
	var edges := 0
	for index in range(visit_order.size() - 1, -1, -1):
		var cell: Dictionary = visit_order[index]
		var down_cell: Variant = cell.get("down_cell", null)
		if down_cell is Dictionary:
			var addition := maxf(0.0, float(cell.get("flow", 0.0))) * loss
			(down_cell as Dictionary)["flow"] = float((down_cell as Dictionary).get("flow", 0.0)) + addition
			transferred += addition
			edges += 1
	var max_flow := 0.0
	for cell: Dictionary in visit_order:
		max_flow = maxf(max_flow, float(cell.get("flow", 0.0)))
	return {"cells": visit_order.size(), "edges": edges, "transferred": transferred, "max_flow": max_flow}

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []
