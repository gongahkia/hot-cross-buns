class_name WorldFloodedCityInundation
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,basin:Dictionary)->Dictionary:
	if basin.is_empty():return {}
	var depth:=maxf(.5,float(basin.get("basin_depth",0.0))*.5+RNG.unit(seed,chunk_x,chunk_z,1103)*2.0);var speed:=.25+RNG.unit(seed,chunk_x,chunk_z,1117)*.75;var direction:=-1.0 if RNG.unit(seed,chunk_x,chunk_z,1123)<.5 else 1.0;var axis:=str(basin.get("shore_axis","x"))
	return {"inundation_depth":depth,"current_x":speed*direction if axis=="x" else 0.0,"current_z":speed*direction if axis=="z" else 0.0}
