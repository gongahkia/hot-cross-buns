class_name WorldFloodedCityRoutes
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,basin:Dictionary,inundation:Dictionary)->Dictionary:
	if basin.is_empty() or inundation.is_empty():return {}
	var canal_axis:=str(basin.get("shore_axis","x"));var bridge_axis:="z" if canal_axis=="x" else "x";var canal_offset:=12.0+RNG.unit(seed,0,chunk_z,1151)*40.0 if canal_axis=="x" else 12.0+RNG.unit(seed,chunk_x,0,1153)*40.0;var bridge_offset:=12.0+RNG.unit(seed,chunk_x,0,1163)*40.0 if bridge_axis=="z" else 12.0+RNG.unit(seed,0,chunk_z,1169)*40.0;var width:=6.0+minf(4.0,float(inundation.get("inundation_depth",0.0)))
	return {"canals":[{"axis":canal_axis,"offset":canal_offset,"width":width}],"bridges":[{"axis":bridge_axis,"offset":bridge_offset,"canal_offset":canal_offset,"length":width+4.0,"height":maxf(2.0,float(inundation.get("inundation_depth",0.0))+1.5)}],"roof_routes":[{"axis":canal_axis,"offset":canal_offset,"height":7.0,"length":18.0}]}
