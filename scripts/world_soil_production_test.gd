extends SceneTree

const SOIL = preload("res://scripts/world_soil_production.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	_expect(absf(SOIL.steady_state_depth(0.0001) - 0.20273255405408) <= EPSILON, "soil steady-state depth drifted")
	_expect(is_zero_approx(SOIL.steady_state_depth(0.00015)), "soil production threshold drifted")
	_expect(absf(SOIL.steady_state_depth(-1.0) - 0.5) <= EPSILON, "soil zero-erosion depth drifted")
	var low := {"elevation": 1.0, "elevation_base": 1.0, "slope": 0.02, "regolith_depth": 0.0}
	var mid := {"elevation": 1.0, "elevation_base": 1.0, "slope": 0.2, "regolith_depth": 0.0}
	var high := {"elevation": 1.0, "elevation_base": 1.0, "slope": 0.8, "regolith_depth": -1.0}
	var result := SOIL.step({"cells": {"low": low, "mid": mid, "high": high}}, {"dt": 0.05})
	_expect(int(result.get("cells", 0)) == 3, "soil production cell count drifted")
	_expect(absf(float(result.get("produced", 0.0)) - 0.0225) <= EPSILON, "soil production total drifted")
	_expect(absf(float(result.get("max_depth", 0.0)) - 0.01125) <= EPSILON, "soil production max depth drifted")
	_expect(float(low.regolith_depth) >= float(mid.regolith_depth) and float(mid.regolith_depth) > float(high.regolith_depth), "regolith depth no longer anti-correlates with slope")
	for cell: Dictionary in [low, mid, high]:
		_expect(float(cell.regolith_depth) >= 0.0, "regolith depth became negative")
		_expect(absf(float(cell.bedrock_elevation) + float(cell.regolith_depth) - float(cell.elevation)) <= EPSILON, "bedrock/regolith invariant drifted")
	var synced := {"elevation_base": 2.0, "regolith_depth": -3.0}
	_expect(SOIL.step({"cells": [synced]}, {}) == {"produced": 0.0, "cells": 0, "max_depth": 0.0} and float(synced.bedrock_elevation) == 2.0, "zero-dt soil sync drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
