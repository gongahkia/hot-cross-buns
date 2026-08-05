extends SceneTree

const HILLSLOPE = preload("res://scripts/world_hillslope.gd")
const DEBRIS = preload("res://scripts/world_debris_flow.gd")

var failed := false

func _initialize() -> void:
	var low := {"gx": 0, "gy": 0, "elevation": 0.0, "regolith_depth": 0.2, "bedrock_elevation": -0.2, "flow": 1.0}
	var high := {"gx": 1, "gy": 0, "elevation": 1.0, "regolith_depth": 1.0, "bedrock_elevation": 0.0, "flow": 100.0, "down_cell": low, "down_distance": 1.0}
	var region := {"cells": {"0:0": low, "1:0": high}, "stride": 1.0}
	var hillslope := HILLSLOPE.diffuse(region, {"dt": 0.01, "iterations": 1})
	_expect(float(hillslope.moved) > 0.0 and float(high.regolith_depth) < 1.0 and float(low.regolith_depth) > 0.2, "hillslope transfer drifted")
	low["sediment_flux"] = 0.0
	high["sediment_flux"] = 100.0
	var debris := DEBRIS.apply({"visit_order": [low, high], "stride": 1.0}, {"critical_concentration": 0.4, "debris_k": 0.01})
	_expect(bool(high.debris_flow) and int(debris.debris_flow_cells) == 1 and float(low.sediment_flux) > 0.0, "debris-flow routing drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
