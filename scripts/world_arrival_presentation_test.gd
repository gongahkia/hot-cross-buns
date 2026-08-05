extends SceneTree
const PRESENTATION = preload("res://scripts/world_arrival_presentation.gd")
var failed := false
func _initialize() -> void:
	var result: Dictionary = PRESENTATION.presentation({"name":"Cedar Reach","family":"flooded_city","landmark":"radio mast"}, "temperate_forest")
	_expect(result.title == "CEDAR REACH" and result.subtitle == "FLOODED CITY / TEMPERATE FOREST", "region arrival labels drifted")
	_expect(result.landmark == "LANDMARK / RADIO MAST" and result.color == Color("#a6d6dc"), "landmark arrival presentation drifted")
	_expect(str(PRESENTATION.presentation({}, "").subtitle) == "WILDERNESS / ", "default arrival presentation drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
