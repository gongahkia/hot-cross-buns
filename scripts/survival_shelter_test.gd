extends SceneTree

const SURVIVAL = preload("res://scripts/survival_state.gd")

var failed := false

func _initialize() -> void:
	var exposed := SURVIVAL.new()
	var sheltered := SURVIVAL.new()
	exposed.begin_run(20260730)
	sheltered.begin_run(20260730)
	var storm := {"temperature": 0.2, "rainfall": 0.9, "weather": {"is_precipitating": true, "intensity": 0.9, "wind_speed": 0.8}}
	exposed.advance(10.0, storm, false)
	storm["shelter"] = 0.75
	sheltered.advance(10.0, storm, false)
	var outside := exposed.snapshot()
	var inside := sheltered.snapshot()
	_expect(float(inside.wetness) < float(outside.wetness) and float(inside.exposure) < float(outside.exposure) and float(inside.warmth) > float(outside.warmth), "shelter protection drifted")
	exposed.free()
	sheltered.free()
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
