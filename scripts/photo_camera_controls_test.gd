extends SceneTree
const CONTROLS = preload("res://scripts/photo_camera_controls.gd")
var failed := false
func _initialize() -> void:
	_expect(CONTROLS.direction(Vector2(1.0,-1.0), true, false) == Vector3(1.0,1.0,-1.0), "free-camera direction drifted")
	_expect(CONTROLS.speed(18.0, true, false) == 45.0 and CONTROLS.speed(18.0, false, true) == 4.5, "free-camera speed modes drifted")
	_expect(CONTROLS.next_speed(72.0, 1) == 72.0 and CONTROLS.next_sensitivity(0.00025, -1) == 0.00025, "free-camera limits drifted")
	_expect(is_equal_approx(CONTROLS.clamp_pitch(PI), deg_to_rad(88.0)), "free-camera pitch clamp drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
