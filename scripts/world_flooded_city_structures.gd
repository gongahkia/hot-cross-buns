class_name WorldFloodedCityStructures
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,inundation:Dictionary)->Dictionary:
	if inundation.is_empty():return {}
	var structures:Array=[];var depth:=float(inundation.get("inundation_depth",0.0))
	for index in range(4):
		var roll:=RNG.unit(seed,chunk_x,chunk_z,1201+index);var collapse:="roof_only" if roll<.22 else "partial" if roll<.58 else "standing";var scale:=.28 if collapse=="roof_only" else .62 if collapse=="partial" else 1.0;var height:=7.0+RNG.unit(seed,chunk_x,chunk_z,1217+index)*16.0
		structures.append({"id":"flood_structure:%d:%d:%d"%[chunk_x,chunk_z,index],"x":8.0+RNG.unit(seed,chunk_x,chunk_z,1231+index)*48.0,"z":8.0+RNG.unit(seed,chunk_x,chunk_z,1247+index)*48.0,"width":7.0+RNG.unit(seed,chunk_x,chunk_z,1261+index)*6.0,"depth":7.0+RNG.unit(seed,chunk_x,chunk_z,1277+index)*6.0,"height":height,"collapse":collapse,"height_scale":scale,"submerged_depth":depth*(.55+RNG.unit(seed,chunk_x,chunk_z,1291+index)*.45)})
	return {"structures":structures}
