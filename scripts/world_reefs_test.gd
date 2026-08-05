extends SceneTree
const REEFS = preload("res://scripts/world_reefs.gd")
var failed := false

func _initialize() -> void:
	_expect(_stage(_region(-0.01, true), 0.0) == 1, "fringing reef stage drifted")
	_expect(_stage(_region(-0.01, false), 0.02) == 2, "barrier reef stage drifted")
	_expect(_stage(_region(-0.01, false), 0.06) == 3, "atoll reef stage drifted")
	_expect(_stage(_region(-0.06, false), 0.06) == 4, "lagoon reef stage drifted")
	_expect(_stage(_region(-0.01, false), 1000000000.0) == 5, "submerged reef stage drifted")
	quit(1 if failed else 0)

func _stage(region: Dictionary, subsidence: float) -> int:
	var stats := REEFS.apply(region, {"seed": 20260730, "geologic_time_my": 1000000.0, "reef_growth_rate": 1.0, "force_subsidence": subsidence})
	_expect(int(stats.candidates) == 1, "reef candidate eligibility drifted")
	return int((region.cells["0:0"] as Dictionary).reef_stage)

func _region(elevation: float, adjacent_land: bool) -> Dictionary:
	var cells := {"0:0": {"gx": 0, "gy": 0, "water": true, "elevation": elevation, "temperature": 0.8, "latitude_radians": 0.0}}
	if adjacent_land: cells["1:0"] = {"gx": 1, "gy": 0, "water": false, "elevation": 0.1}
	return {"cells": cells}

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
