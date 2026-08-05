extends SceneTree
const VOLCANO = preload("res://scripts/world_volcano.gd")
var failed := false

func _initialize() -> void:
	var shield_cells := _grid(31, 15, 15)
	var shield: Dictionary = shield_cells["15:15"]
	shield["hotspot_contribution"] = 0.45; shield["lithology"] = 1
	for gx in range(31):
		(shield_cells["%d:16" % gx] as Dictionary)["elevation"] = -0.05
	var shield_stats := VOLCANO.apply({"cells": shield_cells}, {"seed": 20260730, "max_features": 1, "force_kind": 4})
	_expect(int(shield_stats.candidates) == 1 and int(shield_stats.shields) == 1 and int(shield_stats.lava_flow_cells) > 0 and float(shield_stats.max_delta) > 0.0, "hotspot shield/lava fields drifted")
	var arc_cells := _grid(17, 8, 8)
	var arc: Dictionary = arc_cells["8:8"]
	arc["volcanic_island_arc"] = 0.12
	var arc_stats := VOLCANO.apply({"cells": arc_cells}, {"seed": 20260730, "max_features": 1, "force_caldera": true})
	_expect(int(arc_stats.strato_cones) == 1 and int(arc_stats.calderas) == 1 and int(arc.volcanic_form) == 2, "arc stratocone/caldera fields drifted")
	var fumaroles := {"0:0": {"gx": 0, "gy": 0, "hotspot_contribution": 0.20, "slope": 0.08, "temperature": 0.5, "precipitation": 0.5}, "1:0": {"gx": 1, "gy": 0, "hotspot_contribution": 0.30, "slope": 0.08, "temperature": 0.5, "precipitation": 0.5}}
	var fumarole_stats := VOLCANO.classify_fumaroles({"cells": fumaroles})
	_expect(int(fumarole_stats.fumarole_cells) == 1 and bool((fumaroles["0:0"] as Dictionary).fumarole_field) and not bool((fumaroles["1:0"] as Dictionary).fumarole_field), "fumarole precedence drifted")
	quit(1 if failed else 0)

func _grid(size: int, center_x: int, center_y: int) -> Dictionary:
	var cells := {}
	for gy in range(size):
		for gx in range(size): cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "elevation": 0.0, "slope": 0.0, "lithology": 0, "water": false}
	return cells

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
