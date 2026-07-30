extends SceneTree

const GENERATOR = preload("res://scripts/world_generator.gd")
const FAMILIES := ["reclaimed_city","flooded_city","industrial_ruin","overgrown_suburb","wilderness"]
var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260730)
	for point in [Vector3(-512.0,0.0,-512.0),Vector3(-0.01,0.0,511.99),Vector3(0.0,0.0,0.0),Vector3(511.99,0.0,-0.01),Vector3(1024.0,0.0,768.0)]:
		_assert_sample_contract(generator, point)
	for chunk in [Vector2i(-9,-9),Vector2i(-1,0),Vector2i(0,-1),Vector2i(2,6),Vector2i(17,-13)]:
		_assert_chunk_contract(generator, chunk)
	_expect(generator.region_at(Vector3(-0.01,0.0,-0.01)).id == "-1:-1" and generator.region_at(Vector3.ZERO).id == "0:0" and generator.region_at(Vector3(-512.0,0.0,512.0)).id == "-1:1", "region boundary quantization drifted")
	var families: Dictionary = {}
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			families[str(generator.region_at(Vector3(float(region_x) * GENERATOR.REGION_SIZE,0.0,float(region_z) * GENERATOR.REGION_SIZE)).family)] = true
	for family in FAMILIES: _expect(families.has(family), "region family coverage drifted: " + family)
	var mutated := generator.chunk_descriptor(-9, -9)
	mutated["biome"] = "mutated"
	(mutated.get("region", {}) as Dictionary)["name"] = "mutated"
	var fresh := generator.chunk_descriptor(-9, -9)
	_expect(str(fresh.biome) != "mutated" and str(fresh.region.name) != "mutated", "chunk descriptor leaked mutable state")
	quit(1 if failed else 0)

func _assert_sample_contract(generator: WorldGenerator, point: Vector3) -> void:
	var sample: Dictionary = generator.sample(point.x, point.z)
	_expect(sample == GENERATOR.new(generator.seed).sample(point.x, point.z), "world sample lost determinism")
	_expect(str(sample.scale) == "local" and int(sample.scale_factor) == 1, "world sample scale contract drifted")
	_expect(float(sample.temperature) >= 0.0 and float(sample.temperature) <= 1.0 and float(sample.rainfall) >= 0.0 and float(sample.rainfall) <= 1.0, "world climate bounds drifted")
	_expect(not str(sample.biome).is_empty() and bool(sample.water) == (float(sample.elevation) <= GENERATOR.SEA_LEVEL), "world biome or water contract drifted")
	var region: Dictionary = sample.region
	_expect(str(region.id) == "%d:%d" % [floori(point.x / GENERATOR.REGION_SIZE),floori(point.z / GENERATOR.REGION_SIZE)] and str(region.family) in FAMILIES and not str(region.name).is_empty(), "world region descriptor contract drifted")

func _assert_chunk_contract(generator: WorldGenerator, chunk: Vector2i) -> void:
	var descriptor: Dictionary = generator.chunk_descriptor(chunk.x, chunk.y)
	var center: Vector3 = descriptor.center
	_expect(descriptor == generator.chunk_descriptor(chunk.x, chunk.y), "world chunk descriptor lost determinism")
	_expect(str(descriptor.id) == "%d:%d" % [chunk.x,chunk.y] and center.is_equal_approx(Vector3(float(chunk.x) * GENERATOR.CHUNK_SIZE + GENERATOR.CHUNK_SIZE * 0.5,0.0,float(chunk.y) * GENERATOR.CHUNK_SIZE + GENERATOR.CHUNK_SIZE * 0.5)), "world chunk coordinate contract drifted")
	_expect(descriptor.region == generator.region_at(center) and not str(descriptor.biome).is_empty() and bool(descriptor.water) == (float(generator.sample(center.x, center.z).elevation) <= GENERATOR.SEA_LEVEL), "world chunk sampling contract drifted")

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
