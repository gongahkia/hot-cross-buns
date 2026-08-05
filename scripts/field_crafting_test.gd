extends SceneTree
const SURVIVAL = preload("res://scripts/survival_state.gd")
var failed := false
func _initialize() -> void:
	var survival := SURVIVAL.new()
	survival.begin_run(20260730)
	survival.collect("scrap"); survival.collect("fiber"); survival.collect("dirty_water")
	_expect(survival.craft("water_filter") and int(survival.materials.water) == 1 and int(survival.materials.dirty_water) == 0, "field filter recipe drifted")
	_expect(not survival.craft("water_filter") and not survival.craft("unknown"), "craft validation drifted")
	survival.free(); quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
