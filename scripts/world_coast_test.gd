extends SceneTree
const COAST = preload("res://scripts/world_coast.gd")
var failed := false

func _initialize() -> void:
	var cliff_cells := _coast_cells(12, 0.10, 1.0, 0.0)
	var cliff_stats := COAST.apply({"cells": cliff_cells}, {"sea_level": 0.0})
	_expect(int(cliff_stats.shorelines) == 1 and int(cliff_stats.cliffs) == 12 and bool((cliff_cells["0:1"] as Dictionary).coast_cliff), "coast cliff classification drifted")
	var beach_cells := _coast_cells(12, 0.05, 0.0, 0.01)
	var beach_region := {"cells": beach_cells}
	var beach_stats := COAST.apply(beach_region, {"sea_level": 0.0, "high_angle_fraction": 0.7, "asymmetry": 0.5})
	_expect(int(beach_stats.beaches) == 12 and int(beach_stats.spits) == 1 and int(beach_stats.lagoons) == 1 and bool((beach_cells["0:1"] as Dictionary).coast_beach), "beach/longshore classification drifted")
	quit(1 if failed else 0)

func _coast_cells(width: int, elevation: float, wind_y: float, sediment: float) -> Dictionary:
	var cells := {}
	for gx in range(width):
		cells["%d:0" % gx] = {"gx": gx, "gy": 0, "water": true, "elevation": -0.1}
		cells["%d:1" % gx] = {"gx": gx, "gy": 1, "water": false, "elevation": elevation, "slope": 0.1, "wind_y": wind_y, "sediment": sediment}
	return cells

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
