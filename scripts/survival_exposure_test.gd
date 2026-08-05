extends SceneTree

const SURVIVAL = preload("res://scripts/survival_state.gd")

var failed := false

func _initialize() -> void:
	var survival := SURVIVAL.new()
	survival.begin_run(20260730)
	survival.advance(10.0, {"temperature": 0.2, "rainfall": 0.8, "weather": {"is_precipitating": true, "intensity": 0.9, "wind_speed": 0.7}}, false)
	var rainy := survival.snapshot()
	_expect(float(rainy.wetness) > 0.0 and float(rainy.exposure) > 0.0 and float(rainy.warmth) < 100.0, "rain exposure drifted")
	survival.advance(40.0, {"temperature": 0.8, "rainfall": 0.0, "weather": {"is_precipitating": false, "wind_speed": 0.1}}, false)
	var clear := survival.snapshot()
	_expect(float(clear.wetness) < float(rainy.wetness) and float(clear.exposure) < float(rainy.exposure), "drying/exposure drifted")
	survival.free()
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
