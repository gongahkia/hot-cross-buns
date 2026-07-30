extends SceneTree
const IMPACT = preload("res://scripts/grapple_impact.gd")
var failed := false
func _initialize() -> void:
	_expect(IMPACT.resolve(17.9, Vector3.RIGHT) == Vector3.ZERO, "slow grapple produced impact")
	_expect(is_equal_approx(IMPACT.resolve(18.0, Vector3.RIGHT).x, 8.0), "minimum grapple impact drifted")
	_expect(is_equal_approx(IMPACT.resolve(34.0, Vector3(0.0,0.0,-2.0)).z, -18.0), "maximum grapple impact drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
