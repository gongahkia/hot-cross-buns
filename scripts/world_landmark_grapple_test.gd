extends SceneTree
const LANDMARK_GRAPPLE = preload("res://scripts/world_landmark_grapple.gd")
var failed := false
func _initialize() -> void:
	var record := {"id":"landmark:1:2","kind":"radio mast"}
	var anchor: Dictionary = LANDMARK_GRAPPLE.anchor_spec(record, 18.0)
	_expect(anchor == {"name":"LandmarkGrappleAnchor","landmark_id":"landmark:1:2","height":19.4}, "landmark anchor spec drifted")
	_expect(LANDMARK_GRAPPLE.anchor_spec({}, 18.0).is_empty() and LANDMARK_GRAPPLE.anchor_spec(record, 0.0).is_empty(), "invalid landmark anchors were accepted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
