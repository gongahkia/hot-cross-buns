extends SceneTree

const GLACIERS = preload("res://scripts/world_glaciers.gd")
var failed := false

func _initialize() -> void:
	var high := {"gx": 0, "gy": 0, "elevation": 0.9, "elevation_base": 0.9, "bedrock_elevation": 0.9, "temperature": 0.1, "regolith_depth": 0.0}
	var low := {"gx": 1, "gy": 0, "elevation": 0.6, "elevation_base": 0.6, "bedrock_elevation": 0.6, "temperature": 0.1, "regolith_depth": 0.0}
	var region := {"cells": {"0:0": high, "1:0": low}, "stride": 1.0}
	var result := GLACIERS.glaciate(region, {"dt": 0.1, "sia_iterations": 2, "gamma": 0.01, "kg": 0.01})
	_expect(int(result.glaciated_cells) == 2 and float(result.ice_volume) > 0.0, "glacier accumulation drifted")
	_expect(high.has("ice_thickness") and high.has("glacial_erosion") and (result.ice_state as Dictionary).size() == 2, "glacier fields/state drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
