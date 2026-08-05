extends SceneTree

const FLOOD = preload("res://scripts/world_priority_flood.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var region := {"cells": {}}
	for gy in range(5):
		for gx in range(5):
			var elevation := 0.0 if gx == 0 or gx == 4 or gy == 0 or gy == 4 else 2.0
			if gx == 2 and gy == 2:
				elevation = -2.0
			region.cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "elevation_base": elevation}
	var result := FLOOD.fill(region, {"stride": 2.0, "scale_factor": 4.0})
	_expect(int(result.cells) == 25 and int(result.filled_cells) == 1, "priority flood visit/fill counts drifted")
	var center: Dictionary = region.cells["2:2"]
	_expect(absf(float(center.filled_elevation) - 2.0) <= EPSILON, "depression was not raised to its spill elevation")
	_expect(center.has("down_cell") and float(center.down_distance) > 0.0, "depression routing was not written")
	for cell: Dictionary in region.cells.values():
		_expect(bool(cell.get("hydro_visited", false)), "priority flood left a cell unvisited")
		_expect(float(cell.filled_elevation) >= float(cell.elevation_base), "priority flood lowered a cell")
		if cell.has("down_cell"):
			var down: Dictionary = cell.down_cell
			_expect(float(cell.filled_elevation) + EPSILON >= float(down.filled_elevation), "priority flood routed uphill")
			_expect(float(cell.down_distance) == 8.0 or absf(float(cell.down_distance) - 11.31370849896) <= EPSILON, "priority flood distance scaling drifted")
	var empty := FLOOD.fill({"cells": []})
	_expect(empty == {"visit_order": [], "cells": 0, "filled_cells": 0}, "empty priority flood result drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
