extends SceneTree
const IMPACT = preload("res://scripts/slide_impact.gd")
var failed := false
func _initialize() -> void:
	_expect(IMPACT.resolve(11.9, Vector3.RIGHT) == Vector3.ZERO, "slow slide produced impact")
	_expect(is_equal_approx(IMPACT.resolve(12.0, Vector3.RIGHT).x, 6.0), "minimum slide impact drifted")
	_expect(is_equal_approx(IMPACT.resolve(40.0, Vector3(2.0,0.0,0.0)).x, 16.0), "maximum slide impact drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
