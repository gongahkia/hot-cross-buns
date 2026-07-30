extends SceneTree

const ROUTING = preload("res://scripts/world_d8_routing.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var region := {"cells": {}}
	for gy in range(3):
		for gx in range(3):
			var elevation := 0.0 if gx == 0 or gx == 2 or gy == 0 or gy == 2 else -1.0
			region.cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "elevation_base": elevation}
	var result := ROUTING.route(region)
	_expect(int(result.cells) == 9, "D8 routing visit count drifted")
	var center: Dictionary = region.cells["1:1"]
	_expect(center.has("down_cell") and float(center.down_distance) > 0.0, "D8 routing omitted the interior downstream link")
	_expect(absf(float(center.filled_elevation)) <= EPSILON, "D8 routing did not use priority-filled elevation")
	for cell: Dictionary in region.cells.values():
		if cell.has("down_cell"):
			var down: Dictionary = cell.down_cell
			_expect(float(cell.filled_elevation) + EPSILON >= float(down.filled_elevation), "D8 routing points uphill")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
