extends SceneTree
const IMPACT = preload("res://scripts/slam_impact.gd")
var failed := false
func _initialize() -> void:
	_expect(IMPACT.resolve(15.9, Vector3.ZERO, Vector3.RIGHT) == Vector3.ZERO, "slow slam produced impact")
	_expect(is_equal_approx(IMPACT.resolve(16.0, Vector3.ZERO, Vector3.RIGHT).x, 10.0), "minimum slam impact drifted")
	_expect(is_equal_approx(IMPACT.resolve(40.0, Vector3.ZERO, Vector3(0.0,3.0,2.0)).z, 24.0), "slam radial impact drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
