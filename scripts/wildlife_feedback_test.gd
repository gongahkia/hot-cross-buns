extends SceneTree
const FEEDBACK = preload("res://scripts/wildlife_feedback.gd")
var failed := false
func _initialize() -> void:
	_expect(FEEDBACK.escape("grapple").text == "WILDLIFE ESCAPED — GRAPPLE", "escape feedback drifted")
	_expect(FEEDBACK.injury(6.4).text == "INJURY +06", "injury feedback drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
