extends SceneTree
const RUN_DATA = preload("res://scripts/run_data.gd")
var failed := false
func _initialize() -> void:
	var run := RUN_DATA.new()
	run.begin_run("expedition", 20260730)
	run.add_resource("scrap", 3)
	var record := run.finish("failed", {"alive":false,"failure":"injury"})
	_expect(not run.running and str(run.outcome) == "failed" and str(record.outcome) == "failed" and int(record.resources.scrap) == 3 and not bool(record.survival.alive), "failure resolution drifted")
	run.free(); quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
