extends SceneTree
const ARCHETYPES = preload("res://scripts/wildlife_archetypes.gd")
const BALANCE = preload("res://scripts/wildlife_escape_balance.gd")
var failed := false
func _initialize() -> void:
	for archetype: Dictionary in ARCHETYPES.all():
		var result: Dictionary = BALANCE.rate(archetype, 64)
		_expect(int(result.escaping) == 64 and is_equal_approx(float(result.rate), 1.0), "encounter did not flee across awareness range: "+str(archetype.id))
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
