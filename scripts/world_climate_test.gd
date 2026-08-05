extends SceneTree
const BANDS = preload("res://scripts/world_climate_bands.gd")
const CLIMATE = preload("res://scripts/world_climate.gd")
var failed := false
func _initialize() -> void:
	var cells := {}
	for gx in range(3):
		for gy in range(3): cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "elevation": 0.2 - float(gx) * 0.1, "water": gx == 0}
	var region := {"cells": cells}
	var stats := CLIMATE.solve_region(BANDS.new(20260730), region, {"seed": 20260730})
	var center: Dictionary = cells["1:1"]
	_expect(float(stats.max_precipitation) > 0.0 and center.has("rainfall") and center.has("air_moisture") and center.has("wind_x") and region.climate_samples.size() == 9, "orographic climate fields drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
