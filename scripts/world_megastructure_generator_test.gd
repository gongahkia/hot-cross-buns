extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const HASH := preload("res://scripts/world_megastructure_hash.gd")

const SEED := 20260731
const CELLS := [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i(0, 0, 0), Vector3i(4, 0, -2), Vector3i(7, 0, 5)]
const EXPECTED_HASHES := {
	"-2:0:1": "41d097e2087e2cee54bb41c2c9e291f78d9593b196b0f9df3f60c54ab4b83a68",
	"-1:0:-3": "7f03051f41fe741e37c332c3a452c1feed229c5b056868aba807a642611e8719",
	"0:0:0": "e421559bd70b7981044dc9505c435f6c12d28fe700892fb4f650db74c0126010",
	"4:0:-2": "afe4a3440dabae818174a70d5db9bb4aae1e3f597fd9aa4f7d8d5f63a4a634bd",
	"7:0:5": "fb6090761458b809488e70ee430fef078e0756d320a8b25d972ad84bfc861975",
}
var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(SEED)
	_expect(generator.megacell_at(Vector3i(-1, 0, -1)) == Vector3i(-1, 0, -1) and generator.megacell_at(Vector3i(4095, 0, 4095)) == Vector3i(0, 0, 0) and generator.megacell_at(Vector3i(4096, 4096, -4097)) == Vector3i(1, 1, -2), "megacell quantization drifted")
	var forward := _generate_hashes(generator, CELLS)
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
	var interior: Dictionary = descriptor.get("interior", {})
	_expect(str(descriptor.type) == "megastructure" and str(identity.archetype_id) == "ruined_transcontinental_spine" and int(identity.archetype_version) == 1 and int(identity.descriptor_schema_version) == 8 and str(identity.generator_schema_version) == "2.0.0" and identity.megacell == [cell.x, cell.y, cell.z] and str(identity.world_seed) == str(SEED) and str(identity.structure_id).begins_with("spine:"), "canonical structure identity drifted")
	_assert_epochs(descriptor.get("epochs", []))
	_assert_construction_elements(descriptor.get("construction_elements", []))
	_assert_damage(descriptor.get("damage", []))
	_expect(str(interior.terrain_mode) == "flat_enclosed_floor" and int(interior.floor_y) == 24 and int(interior.ceiling_y) == 100, "interior floor contract drifted")
	_expect(str(entry.entry_type) == "elevated_spine_underpass" and (entry.approach_anchor as Array).size() == 3 and (entry.threshold_volume as Dictionary).has("min") and (entry.threshold_volume as Dictionary).has("max") and int(entry.threshold_visibility_distance) == 96 and (entry.post_threshold_anchor as Array).size() == 3 and (entry.first_goal_anchor as Array).size() == 3 and not str(entry.initial_reveal_id).is_empty(), "entry descriptor contract drifted")
	_expect(routes.size() == 3 and _route_exists(routes, "baseline", "walk", true) and _route_exists(routes, "expressive", "grapple", false) and _route_exists(routes, "survival", "walk", false) and str(routes[0].sector_id).ends_with(":sector"), "opening route descriptor contract drifted")
	var expressive := _route_by_class(routes, "expressive")
	_expect((expressive.waypoints as Array).is_empty() and (expressive.anchor as Array).size() == 3 and (expressive.commit_anchor as Array).size() == 3 and int(expressive.affordance_visibility_distance) == 12 and str(expressive.required_ability) == "grapple" and bool(expressive.recovery_required) and (expressive.recovery_volume as Dictionary).has_all(["min", "max"]), "expressive grapple descriptor contract drifted")
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

func _assert_epochs(epochs: Array) -> void:
	var ids: Array = []
	var ordinals: Array = []
	for epoch: Dictionary in epochs:
		ids.append(int(epoch.get("epoch_id", 0)))
		ordinals.append(int(epoch.get("ordinal", 0)))
		_expect(epoch.has_all(["attachment_policy", "damage_profile", "function", "grammar_id", "hydrology_role", "material_family", "preferred_elevation", "prior_relation", "reclamation_response", "type"]) and str(epoch.get("type", "")) == "construction_epoch", "construction epoch contract drifted")
	_expect(ids == [1, 2, 3, 4, 5, 6] and ordinals == ids and str(epochs[2].get("prior_relation", "")) == "cuts_through_epoch_2" and str(epochs[5].get("prior_relation", "")) == "overgrows_all_prior_epochs", "construction epoch order drifted")

func _assert_construction_elements(elements: Array) -> void:
	var by_id := {}
	var ids: Array = []
	for element: Dictionary in elements:
		var element_id := str(element.get("element_id", ""))
		by_id[element_id] = element
		ids.append(element_id)
	_expect(ids == ["primary_spine_core", "attached_habitation_east", "emergency_breach_channel", "autonomous_machine_clamp", "salvage_refuge_patch", "reclamation_root_lattice"], "construction element order drifted")
	for element: Dictionary in elements:
		_expect(str(element.get("type", "")) == "construction_element" and (element.get("bounds", {}) as Dictionary).has_all(["min", "max"]), "construction element contract drifted")
		var epoch_id := int(element.get("epoch_id", 0))
		var attachment := str(element.get("attachment_target_id", ""))
		if not attachment.is_empty():
			_expect(by_id.has(attachment) and int((by_id[attachment] as Dictionary).get("epoch_id", 0)) < epoch_id, "construction attachment did not target an earlier epoch")
		for cut_target: Variant in element.get("cut_target_ids", []):
			var cut_id := str(cut_target)
			_expect(by_id.has(cut_id) and int((by_id[cut_id] as Dictionary).get("epoch_id", 0)) < epoch_id, "construction cut did not target an earlier epoch")

func _assert_damage(damage: Array) -> void:
	var ids: Array = []
	for record: Dictionary in damage:
		ids.append(str(record.get("target_element_id", "")))
		_expect(str(record.get("type", "")) == "constrained_damage" and str(record.get("severity", "")) in ["minor", "moderate"] and (record.get("affected_route_ids", []) as Array).is_empty() and (record.get("bounds", {}) as Dictionary).has_all(["min", "max"]), "constrained damage contract drifted")
	_expect(ids == ["attached_habitation_east", "autonomous_machine_clamp"], "constrained damage target order drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
