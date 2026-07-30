extends SceneTree
const ATMOSPHERE = preload("res://scripts/world_atmosphere.gd")
var failed := false
func _initialize() -> void:
	var clear: Dictionary = ATMOSPHERE.presentation({"cloud_cover":0.0,"intensity":0.0,"visibility":1.0,"temperature_c":12.0}, {"clock":180.0})
	var storm: Dictionary = ATMOSPHERE.presentation({"cloud_cover":1.0,"intensity":1.0,"visibility":0.2,"temperature_c":12.0}, {"clock":180.0})
	_expect(clear == ATMOSPHERE.presentation({"cloud_cover":0.0,"intensity":0.0,"visibility":1.0,"temperature_c":12.0}, {"clock":180.0}), "atmosphere is not deterministic")
	_expect(float(storm.fog_density) > float(clear.fog_density) and float(clear.sun_energy) > float(storm.sun_energy), "weather atmosphere response drifted")
	_expect(float(ATMOSPHERE.presentation({}, {"clock":360.0}).daylight) > float(ATMOSPHERE.presentation({}, {"clock":0.0}).daylight), "day/night cycle drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
