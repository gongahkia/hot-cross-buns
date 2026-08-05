extends SceneTree
const HIGH_RESOLUTION = preload("res://scripts/photo_high_resolution.gd")
var failed := false
func _initialize() -> void:
	_expect(HIGH_RESOLUTION.target_size(Vector2i(1920,1080)) == Vector2i(3840,2160), "two-times photo resolution drifted")
	var capped := HIGH_RESOLUTION.target_size(Vector2i(7680,4320))
	_expect(capped.x * capped.y <= HIGH_RESOLUTION.MAX_PIXELS and absf(float(capped.x) / float(capped.y) - 16.0 / 9.0) < 0.001, "high-resolution capture cap drifted")
	_expect(HIGH_RESOLUTION.readback_bytes(Vector2i(3840,2160)) == 33_177_600, "high-resolution readback budget drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
