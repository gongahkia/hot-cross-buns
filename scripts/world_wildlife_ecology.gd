class_name WorldWildlifeEcology
extends RefCounted

const ARCHETYPES := preload("res://scripts/wildlife_archetypes.gd")
const RNG := preload("res://scripts/world_rng.gd")

static func generate(seed: int, chunk_x: int, chunk_z: int, descriptor: Dictionary) -> Dictionary:
	var family := str(descriptor.get("region", {}).get("family", ""))
	if family == "flooded_city" or bool(descriptor.get("water", false)): return {}
	var candidates: Array = []
	for archetype: Dictionary in ARCHETYPES.all():
		if (archetype.families as Array).has(family): candidates.append(archetype)
	if candidates.is_empty() or RNG.unit(seed, chunk_x, chunk_z, 2501) < 0.42: return {}
	var archetype: Dictionary = candidates[floori(RNG.unit(seed, chunk_x, chunk_z, 2503) * candidates.size())]
	var record := {"id":"wildlife:%s:%d:%d" % [str(archetype.id), chunk_x, chunk_z],"archetype_id":str(archetype.id),"family":family,"biome":str(descriptor.get("biome", "")),"local_x":8.0+RNG.unit(seed,chunk_x,chunk_z,2507)*48.0,"local_z":8.0+RNG.unit(seed,chunk_x,chunk_z,2509)*48.0}
	return {"animals":[record]}
