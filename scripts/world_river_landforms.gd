class_name WorldRiverLandforms
extends RefCounted

const NEIGHBORS := [{"x": -1, "y": -1}, {"x": 0, "y": -1}, {"x": 1, "y": -1}, {"x": -1, "y": 0}, {"x": 1, "y": 0}, {"x": -1, "y": 1}, {"x": 0, "y": 1}, {"x": 1, "y": 1}]

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var sea_level := float(options.get("sea_level", 0.0))
	var threshold := float(options.get("river_threshold", 82.0))
	for cell: Dictionary in _cells(region):
		var water := bool(cell.get("water", false))
		var flow := float(cell.get("flow", 0.0))
		var slope := float(cell.get("slope", 0.0))
		var elevation := float(cell.get("elevation_base", cell.get("elevation", 0.0)))
		var sediment := float(cell.get("sediment", 0.0))
		var macro_river := float(cell.get("macro_channel_weight", 0.0)) > 0.35
		var channel_context := flow > threshold * 0.35 or float(cell.get("macro_channel_weight", 0.0)) > 0.12
		var mountain_context := bool(cell.get("mountain_range_id", false)) or float(cell.get("uplift", 0.0)) > 0.1 or float(cell.get("plate_boundary", 0.0)) > 0.35
		cell["river"] = not water and cell.has("down_cell") and (flow > threshold or macro_river)
		cell["alluvial_fan"] = not water and sediment > 0.004 and channel_context and mountain_context and slope >= 0.04 and slope < 0.12 and elevation > sea_level + 0.035 and elevation < 0.5
		cell["floodplain"] = not water and sediment > 0.0016 and channel_context and slope < 0.14 and elevation > sea_level + 0.01 and elevation < 0.56
		cell["deposition"] = sediment
		if bool(cell.alluvial_fan):
			cell["deposition"] = float(cell.deposition) + sediment * 0.5
		if bool(cell.floodplain):
			cell["deposition"] = float(cell.deposition) + sediment * 0.75
	_apply_lake_outlets(region, threshold)
	var fan_lobes := _apply_fan_lobes(region)
	for cell: Dictionary in _cells(region):
		if bool(cell.get("river", false)) and not bool(cell.get("water", false)):
			var mouth := false
			var water_level := sea_level
			var down_cell: Variant = cell.get("down_cell", null)
			if down_cell is Dictionary and bool((down_cell as Dictionary).get("water", false)):
				mouth = true
				water_level = float((down_cell as Dictionary).get("lake_surface", sea_level))
			if not mouth:
				for offset: Dictionary in NEIGHBORS:
					var neighbor: Dictionary = (region.get("cells", {}) as Dictionary).get(_key(int(cell.gx) + int(offset.x), int(cell.gy) + int(offset.y)), {})
					if not neighbor.is_empty() and bool(neighbor.get("water", false)):
						mouth = true
						water_level = float(neighbor.get("lake_surface", sea_level))
						break
			var delta := mouth and float(cell.get("sediment", 0.0)) > 0.0014 and float(cell.get("flow", 0.0)) > threshold * 0.2 and float(cell.get("slope", 0.0)) < 0.18 and float(cell.get("elevation_base", cell.get("elevation", 0.0))) < water_level + 0.22
			cell["delta"] = delta
			if delta:
				cell["floodplain"] = true
				cell["deposition"] = maxf(float(cell.get("deposition", 0.0)), float(cell.get("sediment", 0.0)) * 1.8)
	_mark_banks(region)
	var stats := {"rivers": 0, "banks": 0, "floodplains": 0, "deltas": 0, "alluvial_fans": 0, "fan_lobes": fan_lobes}
	for cell: Dictionary in _cells(region):
		if bool(cell.get("river", false)): stats.rivers += 1
		if bool(cell.get("river_bank", false)): stats.banks += 1
		if bool(cell.get("floodplain", false)): stats.floodplains += 1
		if bool(cell.get("delta", false)): stats.deltas += 1
		if bool(cell.get("alluvial_fan", false)): stats.alluvial_fans += 1
	region["river_landforms"] = stats
	return stats

static func _apply_lake_outlets(region: Dictionary, threshold: float) -> void:
	for group: Dictionary in region.get("lake_groups", []):
		var outlet: Dictionary = group.get("outlet", {})
		if not outlet.is_empty() and not bool(outlet.get("water", false)) and float(group.get("max_flow", 0.0)) > threshold * 0.28:
			outlet["river"] = true
			outlet["floodplain"] = bool(outlet.get("floodplain", false)) or (float(outlet.get("sediment", 0.0)) > 0.0016 and float(outlet.get("slope", 0.0)) < 0.16)
			outlet["deposition"] = maxf(float(outlet.get("deposition", 0.0)), float(outlet.get("sediment", 0.0)))

static func _apply_fan_lobes(region: Dictionary) -> int:
	var lobes := 0
	for cell: Dictionary in _cells(region):
		if not bool(cell.get("alluvial_fan", false)):
			continue
		lobes += _mark_fan_lobe(cell)
		var dx := 0
		var dy := 1
		var down_cell: Variant = cell.get("down_cell", null)
		if down_cell is Dictionary:
			dx = signi(int((down_cell as Dictionary).gx) - int(cell.gx))
			dy = signi(int((down_cell as Dictionary).gy) - int(cell.gy))
			if dx == 0 and dy == 0:
				dy = 1
		var px := -dy
		var py := dx
		for offset: Vector2i in [Vector2i(dx, dy), Vector2i(dx + px, dy + py), Vector2i(dx - px, dy - py), Vector2i(px, py), Vector2i(-px, -py)]:
			var target: Dictionary = (region.get("cells", {}) as Dictionary).get(_key(int(cell.gx) + offset.x, int(cell.gy) + offset.y), {})
			lobes += _mark_fan_lobe(target)
	return lobes

static func _mark_fan_lobe(cell: Dictionary) -> int:
	if cell.is_empty() or bool(cell.get("water", false)) or float(cell.get("slope", 0.0)) > 0.18 or bool(cell.get("alluvial_fan_lobe", false)):
		return 0
	cell["alluvial_fan_lobe"] = true
	cell["deposition"] = maxf(float(cell.get("deposition", 0.0)), float(cell.get("sediment", 0.0)) * 1.35)
	return 1

static func _mark_banks(region: Dictionary) -> void:
	for cell: Dictionary in _cells(region):
		cell["river_bank"] = false
	for cell: Dictionary in _cells(region):
		if not bool(cell.get("river", false)):
			continue
		for offset: Dictionary in NEIGHBORS:
			var neighbor: Dictionary = (region.get("cells", {}) as Dictionary).get(_key(int(cell.gx) + int(offset.x), int(cell.gy) + int(offset.y)), {})
			if not neighbor.is_empty() and not bool(neighbor.get("water", false)) and not bool(neighbor.get("river", false)):
				neighbor["river_bank"] = true

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
