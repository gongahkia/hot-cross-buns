extends SceneTree
const GENERATOR = preload("res://scripts/world_generator.gd")
const ECOLOGY = preload("res://scripts/world_urban_resources.gd")
var failed := false
func _initialize() -> void:
	var generator := GENERATOR.new(20260730); var found: Dictionary = {}
	for z in range(-16,17):
		for x in range(-16,17):
			var descriptor := generator.chunk_descriptor(x, z); var family := str(descriptor.region.family)
			if ECOLOGY.FAMILIES.has(family) and not found.has(family): found[family] = descriptor
	for family: String in ECOLOGY.FAMILIES:
		var descriptor: Dictionary = found.get(family, {})
		_expect(not descriptor.is_empty() and descriptor.get("urban_resources", {}) == ECOLOGY.generate(descriptor), "urban resource descriptor drifted: " + family)
		for resource: Dictionary in descriptor.get("urban_resources", {}).get("resources", []): _expect(str(resource.family) == family and not str(resource.id).is_empty() and str(resource.kind) in ["wood","scrap","fiber","food","water"], "urban resource grammar drifted: " + family)
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
