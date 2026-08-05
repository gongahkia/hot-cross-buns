class_name WorldUrbanLandmarks
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const TAXONOMY={"reclaimed_city":"civic_reclamation","flooded_city":"waterworks","industrial_ruin":"industrial_heritage","overgrown_suburb":"domestic_memory"}
const PREFIXES=["Ash","Cedar","Glass","Moss","North","Quiet","Rust","Tide"]

static func describe(seed:int,region:Dictionary)->Dictionary:
	var family:=str(region.get("family",""));var kind:=str(region.get("landmark",""));if kind.is_empty() or not TAXONOMY.has(family):return {}
	var region_x:=int(region.get("x",0));var region_z:=int(region.get("z",0));var prefix:=str(PREFIXES[RNG.hash_int(seed,region_x,region_z,2039)%PREFIXES.size()]);var title:=kind.capitalize();return {"urban_landmark_id":"urban_landmark:%s"%str(region.get("id","%d:%d"%[region_x,region_z])),"taxonomy":str(TAXONOMY[family]),"name":"%s %s"%[prefix,title],"family":family}
