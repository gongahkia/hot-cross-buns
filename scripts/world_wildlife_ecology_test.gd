extends SceneTree
const ECOLOGY = preload("res://scripts/world_wildlife_ecology.gd")
var failed := false
func _initialize() -> void:
	var descriptor := {"region":{"family":"wilderness"},"biome":"temperate_forest","water":false}
	var first: Dictionary = ECOLOGY.generate(20260730, 4, -2, descriptor)
	_expect(first == ECOLOGY.generate(20260730, 4, -2, descriptor), "wildlife ecology is not deterministic")
	_expect(ECOLOGY.generate(20260730, 4, -2, {"region":{"family":"flooded_city"},"water":false}).is_empty() and ECOLOGY.generate(20260730, 4, -2, {"region":{"family":"wilderness"},"water":true}).is_empty(), "invalid wildlife ecology spawned")
	var spawned: Dictionary = {}
	for chunk_x in range(32):
		var result: Dictionary = ECOLOGY.generate(20260730, chunk_x, 0, descriptor)
		if not result.is_empty(): spawned = result; break
	_expect(not spawned.is_empty(), "wildlife ecology did not spawn in sampled wilderness")
	if not spawned.is_empty():
		var animal: Dictionary = (spawned.animals as Array)[0]
		_expect(str(animal.id).begins_with("wildlife:") and str(animal.archetype_id) in ["swift_deer","territorial_boar"] and float(animal.local_x) >= 8.0 and float(animal.local_x) <= 56.0, "wildlife ecology record drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
