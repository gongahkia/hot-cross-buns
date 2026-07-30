class_name WorldHazardPlacement
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func kind_for(biome:String,family:String)->String:
	if family=="industrial_ruin":return "contamination"
	if family=="flooded_city":return "floodwater"
	if biome in ["lava_flow","fumarole_field","hot_spring_travertine"]:return "thermal"
	if biome=="karst":return "sinkhole"
	if biome in ["alpine_scree","permafrost_polygon"]:return "unstable_ground"
	return ""

static func for_chunk(seed:int,chunk_x:int,chunk_z:int,biome:String,family:String)->Dictionary:
	var kind:=kind_for(biome,family)
	if kind.is_empty() or RNG.unit(seed,chunk_x,chunk_z,701)<=.62:return {}
	return {"id":"hazard:%d:%d"%[chunk_x,chunk_z],"kind":kind,"local_x":10.0+RNG.unit(seed,chunk_x,chunk_z,709)*44.0,"local_z":10.0+RNG.unit(seed,chunk_x,chunk_z,719)*44.0}
