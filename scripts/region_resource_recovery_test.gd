extends SceneTree

const GENERATOR = preload("res://scripts/world_generator.gd")
const SURVIVAL = preload("res://scripts/survival_state.gd")
const FAMILIES := ["reclaimed_city","flooded_city","industrial_ruin","overgrown_suburb","wilderness"]
const SHELTER_COST := {"wood":3,"scrap":1,"fiber":2}
var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260730)
	for family in FAMILIES:
		var region := _find_region(generator, family)
		_expect(not region.is_empty(), "resource fixture found no region: " + family)
		if region.is_empty(): continue
		var availability := _availability(generator, region)
		_expect(int(availability.records) > 0 and bool(availability.recovery) and bool(availability.valid) and bool(availability.unique_ids), "region resource/recovery path drifted: " + family)
	_assert_survival_recovery()
	quit(1 if failed else 0)

func _find_region(generator: WorldGenerator, family: String) -> Dictionary:
	for region_z in range(-12,13):
		for region_x in range(-12,13):
			var region := generator.region_at(Vector3(float(region_x) * GENERATOR.REGION_SIZE,0.0,float(region_z) * GENERATOR.REGION_SIZE))
			if str(region.family) == family: return region
	return {}

func _availability(generator: WorldGenerator, region: Dictionary) -> Dictionary:
	var kinds: Dictionary = {}
	var ids: Dictionary = {}
	var records := 0
	var valid := true
	var unique_ids := true
	for chunk_z in range(int(region.z) * 8, int(region.z) * 8 + 8):
		for chunk_x in range(int(region.x) * 8, int(region.x) * 8 + 8):
			var descriptor := generator.chunk_descriptor(chunk_x, chunk_z)
			for record in _resources(descriptor):
				var kind := str(record.get("kind", ""))
				var id := str(record.get("id", ""))
				records += 1
				kinds[kind] = true
				valid = valid and kind in ["wood","scrap","fiber","food","water","dirty_water"] and not id.is_empty()
				if ids.has(id): unique_ids = false
				ids[id] = true
	var recovery := kinds.has("food") or kinds.has("water") or kinds.has("dirty_water") or (kinds.has("wood") and kinds.has("scrap") and kinds.has("fiber"))
	return {"records":records,"recovery":recovery,"valid":valid,"unique_ids":unique_ids}

func _resources(descriptor: Dictionary) -> Array:
	var result: Array = []
	for record in (descriptor.get("natural_resources", {}) as Dictionary).get("resources", []): result.append(record)
	for record in (descriptor.get("urban_resources", {}) as Dictionary).get("resources", []): result.append(record)
	return result

func _assert_survival_recovery() -> void:
	var survivor := SURVIVAL.new()
	survivor.begin_run(20260730)
	for kind in SHELTER_COST:
		survivor.collect(str(kind), int(SHELTER_COST[kind]))
	_expect(survivor.can_spend_materials(SHELTER_COST) and survivor.spend_materials(SHELTER_COST), "shelter-material recovery path drifted")
	survivor.apply_injury(24.0)
	var before := survivor.snapshot()
	survivor.advance(20.0, {"temperature":0.55,"rainfall":1.0,"weather":{"is_precipitating":true,"intensity":1.0,"wind_speed":1.0},"shelter":1.0}, false)
	var after := survivor.snapshot()
	_expect(float(after.injury) < float(before.injury) and float(after.health) > float(before.health) and float(after.exposure) < 0.2, "sheltered survival recovery drifted")
	survivor.free()

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
