class_name WorldIndustrialHazards
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,layout:Dictionary,structures:Dictionary)->Dictionary:
	if layout.is_empty() or structures.is_empty():return {}
	var factories:Array=structures.get("factories",[]);var tanks:Array=structures.get("tanks",[]);if factories.is_empty() or tanks.is_empty():return {}
	var sources:Array=[factories[0],tanks[0]];var fields:Array=[]
	for index in range(2):
		var source:Dictionary=sources[index];var source_kind:="factory" if index==0 else "tank";var spread:=maxf(3.0,(float(source.width) if source_kind=="factory" else float(source.radius)*2.0)*.42);var intensity:=.35+RNG.unit(seed,chunk_x,chunk_z,1583+index)*.6
		fields.append({"id":"industrial_contamination:%d:%d:%d"%[chunk_x,chunk_z,index],"kind":"contamination","source":source_kind,"local_x":clampf(float(source.x)+RNG.signed(seed,chunk_x,chunk_z,1601+index)*spread,3.0,61.0),"local_z":clampf(float(source.z)+RNG.signed(seed,chunk_x,chunk_z,1619+index)*spread,3.0,61.0),"radius":2.4+intensity*4.0,"intensity":intensity})
	return {"fields":fields}
