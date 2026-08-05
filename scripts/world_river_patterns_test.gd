extends SceneTree

const PATTERNS = preload("res://scripts/world_river_patterns.gd")

var failed := false

func _initialize() -> void:
	var braided := {"gx": -1, "gy": 0, "river": true, "water": false, "flow": 100.0, "slope": 0.1, "sediment": 0.01, "sediment_flux": 0.01, "sediment_capacity": 0.005}
	var region := _meander_region()
	region.cells["-1:0"] = braided
	var repeat := _meander_region()
	var result := PATTERNS.apply(region, {"threshold": 10.0, "seed": 20260625, "width_scale": 2.0, "migration_scale": 0.85})
	PATTERNS.apply(repeat, {"threshold": 10.0, "seed": 20260625, "width_scale": 2.0, "migration_scale": 0.85})
	_expect(bool(braided.braided_river) and float(braided.deposition) == 0.012, "braided-river classification drifted")
	var bends := 0
	for gx in range(13):
		var cell: Dictionary = region.cells["%d:%d" % [gx, _y_for(gx)]]
		var repeated: Dictionary = repeat.cells["%d:%d" % [gx, _y_for(gx)]]
		if absf(float(cell.meander_bend)) > 0.1:
			bends += 1
		_expect(float(cell.meander_bend) == float(repeated.meander_bend), "meander migration is not deterministic")
	_expect(int(result.braided_rivers) == 1 and int(result.meanders.lowland_segments) == 1 and float(result.meanders.max_sinuosity) > 1.4 and bends > 4, "meander classification drifted")
	_expect(int(result.meanders.oxbow_lakes) == (region.oxbow_polygons as Array).size(), "oxbow count drifted")
	quit(1 if failed else 0)

func _meander_region() -> Dictionary:
	var cells := {}
	for gx in range(13):
		for gy in range(-4, 5):
			cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "river": false, "water": false, "flow": 0.0, "slope": 0.05}
	var chain: Array = []
	for gx in range(13):
		var cell: Dictionary = cells["%d:%d" % [gx, _y_for(gx)]]
		cell["river"] = true
		cell["flow"] = 100.0
		chain.append(cell)
	for index in range(chain.size() - 1):
		(chain[index] as Dictionary)["down_cell"] = chain[index + 1]
	return {"cells": cells}

func _y_for(gx: int) -> int:
	return [0, 1, 0, -1][gx % 4]

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
