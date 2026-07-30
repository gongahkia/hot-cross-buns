extends SceneTree
const RUN_DATA = preload("res://scripts/run_data.gd")
var failed := false
func _initialize() -> void:
	var run := RUN_DATA.new()
	run.begin_run("expedition", 20260730)
	run.add_resource("wood", 2)
	var record := run.finish("extracted", {"health": 88.0})
	_expect(not run.running and str(run.outcome) == "extracted" and str(record.outcome) == "extracted" and int(record.resources.wood) == 2 and float(record.survival.health) == 88.0, "extraction resolution drifted")
	_expect(run.finish("failed", {"health": 0.0}) == {"level":"expedition","seed":20260730,"elapsed":0.0,"collectibles":0,"resources":{"wood":2},"regions":[],"style":run.style.snapshot(),"survival":{"health":0.0},"outcome":"extracted"}, "completed run changed")
	run.free(); quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
