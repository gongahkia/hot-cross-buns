extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const HASH := preload("res://scripts/world_megastructure_hash.gd")

const SEED := 20260731
const CELLS := [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i(0, 0, 0), Vector3i(4, 0, -2), Vector3i(7, 0, 5)]
const EXPECTED_HASHES := {
	"-2:0:1": "6c036cea71d2acc8dc58a0a083c905d3427ab62d14d1009a81b6c42b55973ba6",
	"-1:0:-3": "4739125056da264c842dee67a27da99e5b1f17cd142716096a110411c9249cf6",
	"0:0:0": "25f7597729772a7088d7f5be91a49f0d557aefb800a7d377559682035db25736",
	"4:0:-2": "648aaa1cdab54937d1a4928f028a370369f5c6077347f00cf85b93c4046bf790",
	"7:0:5": "32a09660ca0aa7049701bfaa671f9614b524b0046758e434c146070fef30a2ca",
}
var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(SEED)
	_expect(generator.megacell_at(Vector3i(-1, 0, -1)) == Vector3i(-1, 0, -1) and generator.megacell_at(Vector3i(4095, 0, 4095)) == Vector3i(0, 0, 0) and generator.megacell_at(Vector3i(4096, 4096, -4097)) == Vector3i(1, 1, -2), "megacell quantization drifted")
	var forward := _generate_hashes(generator, CELLS)
	print(JSON.stringify(forward))
	_expect(forward == EXPECTED_HASHES, "megastructure descriptor golden hashes drifted")
	_expect(HASH.canonical_json({"b": 1, "a": [true, null]}) == "{\"a\":[true,null],\"b\":1}" and HASH.canonical_json(0.5).is_empty(), "canonical serialization contract drifted")
	var reversed_cells := CELLS.duplicate()
	reversed_cells.reverse()
	_expect(forward == _generate_hashes(generator, reversed_cells), "reverse generation order changed descriptors")
	var shuffled := [CELLS[2], CELLS[4], CELLS[0], CELLS[3], CELLS[1]]
	_expect(forward == _generate_hashes(GENERATOR.new(SEED), shuffled), "shuffled generation order changed descriptors")
	for cell: Vector3i in CELLS:
		_assert_descriptor(generator.generate(cell), cell)
	var first := generator.generate(CELLS[0])
	(first.get("entry", {}) as Dictionary)["entry_type"] = "mutated"
	_expect(str((generator.generate(CELLS[0]).entry as Dictionary).entry_type) == "elevated_spine_underpass", "descriptor leaked mutable state")
	_expect(generator.generate(CELLS[0]).canonical_hash != GENERATOR.new(SEED + 1).generate(CELLS[0]).canonical_hash, "world seed did not participate in descriptor identity")
	_expect(generator.generate(CELLS[0]).canonical_hash != GENERATOR.new(SEED, "1.0.1").generate(CELLS[0]).canonical_hash, "generator schema version did not participate in descriptor identity")
	quit(1 if failed else 0)

func _generate_hashes(generator, cells: Array) -> Dictionary:
	var hashes := {}
	for cell: Vector3i in cells:
		var descriptor: Dictionary = generator.generate(cell)
		hashes["%d:%d:%d" % [cell.x, cell.y, cell.z]] = descriptor.canonical_hash
	return hashes

func _assert_descriptor(descriptor: Dictionary, cell: Vector3i) -> void:
	var identity: Dictionary = descriptor.get("identity", {})
	var entry: Dictionary = descriptor.get("entry", {})
	var routes: Array = descriptor.get("routes", [])
	var reveals: Array = descriptor.get("reveals", [])
	_expect(str(descriptor.type) == "megastructure" and str(identity.archetype_id) == "ruined_transcontinental_spine" and int(identity.archetype_version) == 1 and identity.megacell == [cell.x, cell.y, cell.z] and str(identity.world_seed) == str(SEED) and str(identity.structure_id).begins_with("spine:"), "canonical structure identity drifted")
	_expect(str(entry.entry_type) == "elevated_spine_underpass" and (entry.approach_anchor as Array).size() == 3 and (entry.threshold_volume as Dictionary).has("min") and (entry.threshold_volume as Dictionary).has("max") and (entry.post_threshold_anchor as Array).size() == 3 and (entry.first_goal_anchor as Array).size() == 3 and not str(entry.initial_reveal_id).is_empty(), "entry descriptor contract drifted")
	_expect(routes.size() == 3 and _route_exists(routes, "baseline", "walk", true) and _route_exists(routes, "expressive", "grapple", false) and _route_exists(routes, "survival", "walk", false) and str(routes[0].sector_id).ends_with(":sector"), "opening route descriptor contract drifted")
	var survival := _route_by_class(routes, "survival")
	_expect(str(survival.survival_opportunity) == "warm_utility_refuge" and int(survival.shelter_basis_points) > 0 and int(survival.exposure_reduction_basis_points) > 0 and int(survival.warmth_recovery_basis_points) > 0, "survival detour lost warmth/shelter/exposure contract")
	_expect(reveals.size() == 1 and str(reveals[0].reveal_type) == "transcontinental_spine_continuation" and int(reveals[0].minimum_visibility_distance) >= 1024, "initial reveal descriptor contract drifted")
	var clone := descriptor.duplicate(true)
	clone.erase("canonical_hash")
	_expect(str(descriptor.canonical_hash) == HASH.canonical_hash(clone) and str(descriptor.canonical_hash).length() == 64, "canonical descriptor hash drifted")

func _route_exists(routes: Array, route_class: String, movement_mode: String, mandatory: bool) -> bool:
	for route: Dictionary in routes:
		if str(route.route_class) == route_class and str(route.movement_mode) == movement_mode and bool(route.mandatory) == mandatory:
			return true
	return false

func _route_by_class(routes: Array, route_class: String) -> Dictionary:
	for route: Dictionary in routes:
		if str(route.route_class) == route_class:
			return route
	return {}

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
