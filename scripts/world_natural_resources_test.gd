extends SceneTree
const ECOLOGY = preload("res://scripts/world_natural_resources.gd")
const GENERATOR = preload("res://scripts/world_generator.gd")
var failed := false
func _initialize() -> void:
	var sample := {"region":{"family":"wilderness"},"biome":"temperate_forest","water":false}; var result := ECOLOGY.generate(20260730,4,-2,sample)
	_expect(result == ECOLOGY.generate(20260730,4,-2,sample) and (result.get("resources",[]) as Array).size() <= 2, "natural ecology determinism drifted")
	for resource: Dictionary in result.get("resources",[]): _expect(str(resource.id).begins_with("natural:temperate_forest:") and str(resource.kind) in ["wood","fiber","food"], "forest resource ecology drifted")
	_expect(ECOLOGY.generate(20260730,4,-2,{"region":{"family":"wilderness"},"biome":"desert","water":true}).is_empty(), "water received land resources")
	var generator := GENERATOR.new(20260730); var descriptor := generator.chunk_descriptor(0,0)
	if str(descriptor.region.family) == "wilderness": _expect(descriptor.get("natural_resources",{}) == ECOLOGY.generate(20260730,0,0,generator.sample(32.0,32.0)), "natural descriptor wiring drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
