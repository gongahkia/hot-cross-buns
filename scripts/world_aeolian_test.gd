extends SceneTree
const AEOLIAN = preload("res://scripts/world_aeolian.gd")
var failed := false
func _initialize() -> void:
	var cells := {}
	for gx in range(12): cells["%d:0" % gx] = {"gx": gx, "gy": 0, "biome": "desert", "elevation": 0.0}
	var result := AEOLIAN.apply({"cells": cells}, {"seed": 20260625, "sand_cover": 1.0, "iterations": 60, "wind_x": 1.0})
	_expect(int(result.cells) == 12 and str(result.morphology) == "transverse" and int(result.iterations) == 60, "dune generation metadata drifted")
	_expect((cells["0:0"] as Dictionary).has("dune_morphology") and float(result.max_amplitude) >= 0.0, "dune fields drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
