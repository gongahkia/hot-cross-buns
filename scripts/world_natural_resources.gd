class_name WorldNaturalResources
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

static func generate(seed: int, chunk_x: int, chunk_z: int, sample: Dictionary) -> Dictionary:
	if str(sample.get("region", {}).get("family", "")) != "wilderness" or bool(sample.get("water", false)): return {}
	var biome := str(sample.get("biome", "grassland")); var kinds := _kinds(biome); var resources: Array = []
	for index in range(2):
		if RNG.unit(seed, chunk_x, chunk_z, 2201 + index) < 0.28: continue
		var kind := str(kinds[floori(RNG.unit(seed, chunk_x, chunk_z, 2211 + index) * kinds.size())])
		resources.append({"id":"natural:%s:%d:%d:%d" % [biome, chunk_x, chunk_z, index], "kind":kind, "biome":biome, "local_x":8.0 + RNG.unit(seed,chunk_x,chunk_z,2221+index)*48.0, "local_z":8.0 + RNG.unit(seed,chunk_x,chunk_z,2231+index)*48.0})
	return {} if resources.is_empty() else {"resources":resources}

static func _kinds(biome: String) -> Array:
	if biome in ["temperate_forest","rainforest","boreal_forest","cloud_forest","conifer_forest","mixed_forest","riparian_gallery_forest"]: return ["wood","fiber","food"]
	if biome in ["desert","cold_desert","badland","dune_sea_erg","alpine_scree","tundra"]: return ["fiber","scrap","water"]
	if biome in ["wetland","lagoon","mangrove","oasis"]: return ["fiber","food","water"]
	return ["fiber","food","wood"]
