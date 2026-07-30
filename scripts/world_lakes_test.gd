extends SceneTree

const LAKES = preload("res://scripts/world_lakes.gd")

var failed := false

func _initialize() -> void:
	var outlet := {"gx": 2, "gy": 0, "elevation_base": 0.3, "filled_elevation": 0.3, "flow": 4.0}
	var second := {"gx": 1, "gy": 0, "elevation_base": 0.2, "filled_elevation": 1.0, "flow": 3.0, "down_cell": outlet}
	var first := {"gx": 0, "gy": 0, "elevation_base": 0.2, "filled_elevation": 1.0, "flow": 2.0, "down_cell": second}
	var region := {"scale": "local", "cells": {"0:0": first, "1:0": second, "2:0": outlet}}
	var groups := LAKES.apply(region)
	_expect(groups.size() == 1 and int(first.lake_group_size) == 2 and int(second.lake_group_size) == 2, "lake grouping drifted")
	_expect(str(first.lake_id) == str(second.lake_id) and int(first.outlet_gx) == 2, "lake outlet assignment drifted")
	_expect(bool(outlet.spillover) and str(outlet.spillover_lake_id) == str(first.lake_id) and float(outlet.spillover_flow) == 3.0, "lake spillover routing drifted")
	_expect(bool(first.water) and bool(second.water) and not bool(outlet.water), "lake water state drifted")
	var cenote := {"gx": 0, "gy": 1, "elevation_base": 0.2, "filled_elevation": 0.2, "cenote": true}
	LAKES.mark_candidates({"cells": [cenote]})
	_expect(bool(cenote.lake) and float(cenote.lake_depth) == 0.012, "cenote lake candidate drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
