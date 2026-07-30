extends SceneTree
const KOPPEN = preload("res://scripts/world_koppen.gd")
var failed := false
func _initialize() -> void:
	_expect(KOPPEN.classify(0.1, 0.8) == "EF" and KOPPEN.classify(0.18, 0.8) == "ET" and KOPPEN.classify(0.7, 0.1) == "BWh" and KOPPEN.classify(0.5, 0.1) == "BWk", "polar/arid Köppen branches drifted")
	_expect(KOPPEN.classify(0.7, 0.8) == "Af" and KOPPEN.classify(0.7, 0.4, {"monsoon_index": 0.3}) == "Am" and KOPPEN.classify(0.7, 0.4) == "Aw", "tropical Köppen branches drifted")
	_expect(KOPPEN.classify(0.6, 0.4, {"latitude_radians": 0.6}) == "Csa" and KOPPEN.classify(0.5, 0.6) == "Cfb" and KOPPEN.classify(0.3, 0.4) == "Dwb" and KOPPEN.classify(0.3, 0.5) == "Dfb", "temperate/continental Köppen branches drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
