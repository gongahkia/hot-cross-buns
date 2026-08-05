extends SceneTree
const BATHYMETRY = preload("res://scripts/world_bathymetry.gd")
const TECTONICS = preload("res://scripts/world_tectonics.gd")
var failed := false

func _initialize() -> void:
	var origin := {"gx": 0, "gy": 0, "water": true, "shelf_distance": 10.0, "elevation": -0.01, "flow": 0.0}
	var deep := {"gx": 0, "gy": 1, "water": true, "shelf_distance": 999.0, "elevation": -0.08}
	var land := {"gx": 1, "gy": 0, "water": false, "elevation": 0.1}
	var stats := BATHYMETRY.apply({"cells": {"0:0": origin, "0:1": deep, "1:0": land}}, {"seed": 20260730, "canyon_density": 1.0})
	_expect(BATHYMETRY.is_shelf(origin) and int(stats.candidates) == 1 and int(stats.canyons) == 1 and int(stats.canyon_cells) >= 2 and bool(origin.submarine_canyon) and bool(deep.submarine_canyon), "shelf/canyon fields drifted")
	var highest := 0.0; var seamount_x := 0.0; var seamount_z := 0.0
	for gz in range(-5, 6):
		for gx in range(-5, 6):
			var contribution := BATHYMETRY.seamount_at(20260730, float(gx * 10 + 5), float(gz * 10 + 5), 1.0, {"crust": "oceanic"})
			if contribution > highest: highest = contribution; seamount_x = float(gx * 10 + 5); seamount_z = float(gz * 10 + 5)
	var tectonic := TECTONICS.new(20260730).synthesize({"plate": {"crust": "oceanic"}, "scale_factor": 1.0, "warped_x": seamount_x, "warped_z": seamount_z, "elevation": 0.0})
	_expect(highest > 0.0 and float(tectonic.seamount_contribution) == highest and BATHYMETRY.seamount_at(20260730, 0.0, 0.0, 1.0, {"crust": "continental"}) == 0.0, "seamount field drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
