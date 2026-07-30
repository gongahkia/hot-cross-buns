extends SceneTree
const PERIGLACIAL = preload("res://scripts/world_periglacial.gd")
var failed := false
func _initialize() -> void:
	var pingo := {"gx": 0, "gy": 0, "temperature": 0.1, "biome": "tundra", "slope": 0.0, "elevation": 1.0}
	var pingo_stats := PERIGLACIAL.apply({"cells": {"0:0": pingo}}, {"seed": 1, "pingo_density": 1.0})
	_expect(int(pingo_stats.pingos) == 1 and int(pingo.periglacial_feature) == 1 and float(pingo.elevation) > 1.0, "pingo stamp drifted")
	var palsa := {"gx": 0, "gy": 0, "temperature": 0.2, "moisture": 0.8, "slope": 0.0, "elevation": 1.0}
	var palsa_stats := PERIGLACIAL.apply({"cells": {"0:0": palsa}}, {"seed": 1, "pingo_density": 0.0, "palsa_density": 1.0})
	_expect(int(palsa_stats.palsas) == 1 and int(palsa.periglacial_feature) == 2, "palsa stamp drifted")
	var solifluction := {"gx": 1, "gy": 1, "temperature": 0.2, "slope": 0.15, "elevation": 1.0}
	var solifluction_stats := PERIGLACIAL.apply({"cells": {"1:1": solifluction}}, {"seed": 1, "pingo_density": 0.0, "palsa_density": 0.0})
	_expect(int(solifluction_stats.solifluction) == 1 and int(solifluction.periglacial_feature) == 4, "solifluction drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
