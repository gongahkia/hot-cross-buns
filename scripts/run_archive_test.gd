extends SceneTree
const ARCHIVE = preload("res://scripts/run_archive.gd")
var failed := false
func _initialize() -> void:
	var archive := ARCHIVE.new()
	_expect(archive.append({"outcome":"active"}).is_empty(), "active run entered archive")
	var first := archive.append({"outcome":"extracted","level":"expedition","seed":7,"elapsed":12.5,"collectibles":3,"resources":{"wood":2},"regions":["north"],"survival":{"health":80.0}})
	_expect(int(first.id) == 1 and (archive.list() as Array).size() == 1 and int((archive.list() as Array)[0].resources.wood) == 2, "archive record drifted")
	first.resources["wood"] = 99
	_expect(int((archive.list() as Array)[0].resources.wood) == 2, "archive leaked mutable record")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
