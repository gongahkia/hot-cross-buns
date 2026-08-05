class_name WorldResourcePlacement
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const URBAN_FAMILIES=["reclaimed_city","flooded_city","industrial_ruin","overgrown_suburb"]

static func for_chunk(seed:int,chunk_x:int,chunk_z:int,family:String)->Dictionary:
	var roll:=RNG.unit(seed,chunk_x,chunk_z,313)
	if roll<=.32:return {}
	var kind:="scrap" if family in URBAN_FAMILIES else "wood"
	if roll>.86:kind="water" if family=="flooded_city" else "food"
	return {"id":"resource:%d:%d"%[chunk_x,chunk_z],"kind":kind,"local_x":8.0+RNG.unit(seed,chunk_x,chunk_z,401)*48.0,"local_z":8.0+RNG.unit(seed,chunk_x,chunk_z,403)*48.0}
