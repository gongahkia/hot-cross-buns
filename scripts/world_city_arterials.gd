class_name WorldCityArterials
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,layout:Dictionary)->Dictionary:
	if layout.is_empty():return {}
	var axis:=str(layout.get("spine_axis","x"));var slope:=float(layout.get("terrain_slope",0.0));var primary_weight:=clampf(1.0-slope*.05,.55,1.0)
	var tensor:Dictionary={"xx":primary_weight if axis=="x" else 1.0-primary_weight,"xz":0.0,"zz":primary_weight if axis=="z" else 1.0-primary_weight}
	var primary_offset:=10.0+RNG.unit(seed,0,chunk_z,821)*44.0 if axis=="x" else 10.0+RNG.unit(seed,chunk_x,0,823)*44.0
	var cross_axis:="z" if axis=="x" else "x";var cross_offset:=10.0+RNG.unit(seed,chunk_x,0,827)*44.0 if cross_axis=="z" else 10.0+RNG.unit(seed,0,chunk_z,829)*44.0
	return {"tensor":tensor,"arterials":[{"axis":axis,"offset":primary_offset,"width":6.0},{"axis":cross_axis,"offset":cross_offset,"width":4.0}]}
