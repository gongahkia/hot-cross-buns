extends SceneTree
const LAYERS = preload("res://scripts/weather_layers.gd")
var failed := false
func _initialize() -> void:
	var clear: Dictionary = LAYERS.profile({"intensity":0.0,"visibility":1.0,"audio_cue":"none"})
	var storm: Dictionary = LAYERS.profile({"precipitation":"rain","intensity":0.8,"visibility":0.4,"audio_cue":"rain"})
	_expect(int(clear.particles) == 0 and str(clear.audio) == "none", "clear weather layers drifted")
	_expect(int(storm.particles) > 0 and str(storm.audio) == "rain" and float(storm.opacity) > 0.5, "storm weather layers drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
