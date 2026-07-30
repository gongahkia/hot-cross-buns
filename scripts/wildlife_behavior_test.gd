extends SceneTree
const ARCHETYPES = preload("res://scripts/wildlife_archetypes.gd")
const BEHAVIOR = preload("res://scripts/wildlife_behavior.gd")
var failed := false
func _initialize() -> void:
	var deer: Dictionary = ARCHETYPES.by_id("swift_deer")
	var idle: Dictionary = BEHAVIOR.step(deer, Vector3.ZERO, Vector3(40.0, 0.0, 0.0))
	var fleeing: Dictionary = BEHAVIOR.step(deer, Vector3.ZERO, Vector3(8.0, 0.0, 0.0))
	_expect(idle.state == "idle" and is_zero_approx(float(idle.speed)), "wildlife perception range drifted")
	_expect(fleeing.state == "flee" and fleeing.direction.x < -0.99 and is_equal_approx(float(fleeing.speed), 7.0), "wildlife avoidance vector drifted")
	var boar: Dictionary = ARCHETYPES.by_id("territorial_boar")
	var warning: Dictionary = BEHAVIOR.step(boar, Vector3.ZERO, Vector3(5.0, 0.0, 0.0))
	_expect(warning.state == "warn" and bool(warning.warning_issued) and BEHAVIOR.step(boar, Vector3.ZERO, Vector3(5.0, 0.0, 0.0), true).state == "flee", "territorial wildlife behavior drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
