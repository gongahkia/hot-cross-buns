extends SceneTree
const KARST = preload("res://scripts/world_karst.gd")
var failed := false
func _initialize() -> void:
	var cell := {"gx": 0, "gy": 0, "lithology": 4, "elevation": 1.0, "rainfall": 1.0, "latitude_radians": 0.0, "slope": 0.0}
	var stats := KARST.apply({"cells": {"0:0": cell}}, {"seed": 1, "density": 1.0, "force_kind": 1})
	_expect(int(stats.features) == 1 and int(cell.karst_type) == 1 and float(cell.karst_depth) > 0.0 and float(cell.cave_presence) > 0.0, "karst doline/cave fields drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
