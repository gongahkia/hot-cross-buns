extends SceneTree
const SETTINGS = preload("res://scripts/settings.gd")
var failed := false
func _initialize() -> void:
	var settings := SETTINGS.new()
	_expect(settings.wildlife_encounters, "wildlife encounters default changed")
	settings.wildlife_encounters = false
	_expect(not settings.wildlife_encounters, "wildlife encounters toggle did not update")
	settings.free()
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
