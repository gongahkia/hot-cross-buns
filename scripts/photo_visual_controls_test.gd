extends SceneTree
const VISUALS = preload("res://scripts/photo_visual_controls.gd")
var failed := false
func _initialize() -> void:
	_expect(VISUALS.defaults(140.0) == {"fov":110.0,"exposure":1.0,"focus_distance":24.0,"blur_amount":0.0,"filter_index":0}, "photo visual defaults drifted")
	_expect(VISUALS.fov(22.0, -1) == 22.0 and VISUALS.fov(110.0, 1) == 110.0, "photo FOV limits drifted")
	_expect(VISUALS.exposure(1.0, 1) == 1.1 and VISUALS.focus_distance(2.0, -1) == 2.0 and VISUALS.blur_amount(1.0, 1) == 1.0, "photo visual control limits drifted")
	_expect(VISUALS.next_filter(3) == 0 and str(VISUALS.filter(2).name) == "amber", "photo filter sequence drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
