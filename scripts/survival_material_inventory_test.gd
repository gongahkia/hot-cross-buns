extends SceneTree

const SURVIVAL = preload("res://scripts/survival_state.gd")

var failed := false

func _initialize() -> void:
	var survival := SURVIVAL.new()
	survival.begin_run(20260730)
	_expect(survival.collect("wood", 3) and survival.collect("scrap", 2) and survival.collect("fiber", 1), "material collection drifted")
	_expect(survival.scavenged_materials() == {"wood": 3, "scrap": 2, "fiber": 1}, "material inventory snapshot drifted")
	_expect(survival.can_spend_materials({"wood": 2, "scrap": 1}) and survival.spend_materials({"wood": 2, "scrap": 1}), "material spending drifted")
	var after := survival.scavenged_materials()
	_expect(after == {"wood": 1, "scrap": 1, "fiber": 1} and not survival.spend_materials({"wood": 2}) and survival.scavenged_materials() == after, "material spending atomicity drifted")
	_expect(not survival.collect("stone", 1) and not survival.can_spend_materials({"food": 1}) and not survival.can_spend_materials({}), "material validation drifted")
	survival.free()
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
