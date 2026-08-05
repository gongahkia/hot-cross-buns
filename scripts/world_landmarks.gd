class_name WorldLandmarks
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const URBAN_LANDMARKS=preload("res://scripts/world_urban_landmarks.gd")
const CHUNKS_PER_REGION:=8
var records:Dictionary={}

func for_chunk(seed:int,region:Dictionary,chunk_x:int,chunk_z:int)->Dictionary:
	var record:=record_for(seed,region)
	if record.is_empty() or int(record.chunk_x)!=chunk_x or int(record.chunk_z)!=chunk_z:return {}
	return record

func record_for(seed:int,region:Dictionary)->Dictionary:
	var kind:=str(region.get("landmark",""))
	if kind.is_empty():return {}
	var region_x:=int(region.get("x",0));var region_z:=int(region.get("z",0));var id:=str(region.get("id","%d:%d"%[region_x,region_z]))
	if not records.has(id):
		var record:Dictionary={"id":"landmark:"+id,"kind":kind,"chunk_x":region_x*CHUNKS_PER_REGION+RNG.hash_int(seed,region_x,region_z,601)%CHUNKS_PER_REGION,"chunk_z":region_z*CHUNKS_PER_REGION+RNG.hash_int(seed,region_x,region_z,607)%CHUNKS_PER_REGION,"local_x":10.0+RNG.unit(seed,region_x,region_z,613)*44.0,"local_z":10.0+RNG.unit(seed,region_x,region_z,619)*44.0};record.merge(URBAN_LANDMARKS.describe(seed,region));records[id]=record
	return (records[id] as Dictionary).duplicate(true)
