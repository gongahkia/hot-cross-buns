extends SceneTree
const MELEE = preload("res://scripts/traversal_melee.gd")
var failed := false
func _initialize() -> void:
	_expect(not bool(MELEE.hit("walk", 30.0, Vector3.ZERO, Vector3.ZERO).hit), "non-traversal melee activated")
	_expect(MELEE.hit("slide", 11.9, Vector3.ZERO, Vector3.ZERO).reason == "insufficient_speed", "slide speed gate drifted")
	_expect(bool(MELEE.hit("slide", 12.0, Vector3.ZERO, Vector3(2.2, 0.0, 0.0)).hit), "slide range edge missed")
	_expect(not bool(MELEE.hit("slam", 16.0, Vector3.ZERO, Vector3(3.01, 0.0, 0.0)).hit), "slam range leaked")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
