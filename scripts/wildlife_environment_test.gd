extends SceneTree
const ENVIRONMENT = preload("res://scripts/wildlife_environment.gd")
var failed := false
func _initialize() -> void:
	_expect(not bool(ENVIRONMENT.evaluate({"water":true}).can_move), "water did not gate ground wildlife")
	_expect(is_equal_approx(float(ENVIRONMENT.evaluate({"slope":0.0}).speed_multiplier), 1.0) and is_equal_approx(float(ENVIRONMENT.evaluate({"slope":1.0}).speed_multiplier), 0.45), "terrain speed response drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
