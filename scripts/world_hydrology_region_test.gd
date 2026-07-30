extends SceneTree

const HYDROLOGY = preload("res://scripts/world_hydrology_region.gd")

var failed := false

func _initialize() -> void:
	var region := {"scale": "region", "scale_factor": 2.0, "cells": {}}
	for gy in range(3):
		for gx in range(3):
			var elevation := 0.0
			var rainfall := 0.1
			if gx == 1 and gy == 1:
				elevation = 1.0
				rainfall = 2.0
			region.cells["%d:%d" % [gx, gy]] = {"gx": gx, "gy": gy, "elevation_base": elevation, "rainfall": rainfall}
	var result := HYDROLOGY.solve(region)
	_expect(str(result.scale_id) == "region" and float(result.river_threshold) == 46.0, "hydrology scale threshold drifted")
	_expect(int(result.routing.cells) == 9 and int(result.accumulation.edges) == 1, "hydrology routing/accumulation topology drifted")
	var center: Dictionary = region.cells["1:1"]
	_expect(center.has("down_cell") and float(center.flow) == 2.0, "hydrology headwater setup drifted")
	_expect(float(center.hydro_slope) > 0.0 and float(center.slope) > 0.0, "hydrology slope derivation drifted")
	var down: Dictionary = center.down_cell
	_expect(float(down.flow) > 2.0 and float(down.hydro_slope) == 0.0, "hydrology downstream accumulation drifted")
	_expect(HYDROLOGY.river_threshold("local") == 82.0 and HYDROLOGY.river_threshold("continent") == 24.0, "hydrology threshold mapping drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
