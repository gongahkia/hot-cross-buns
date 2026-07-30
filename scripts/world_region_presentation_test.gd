extends SceneTree
const PRESENTATION = preload("res://scripts/world_region_presentation.gd")
var failed := false
func _initialize() -> void:
	var city: Dictionary = PRESENTATION.palette("temperate_forest","reclaimed_city")
	var flood: Dictionary = PRESENTATION.palette("temperate_forest","flooded_city")
	_expect(city == PRESENTATION.palette("temperate_forest","reclaimed_city") and city.terrain != flood.terrain, "regional palette determinism drifted")
	_expect(float((city.silhouette as Color).get_luminance()) < float((city.terrain as Color).get_luminance()), "far silhouette no longer separates")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
