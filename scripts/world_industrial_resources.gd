class_name WorldIndustrialResources
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,layout:Dictionary,structures:Dictionary)->Dictionary:
	if layout.is_empty() or structures.is_empty():return {}
	var factories:Array=structures.get("factories",[]);var tanks:Array=structures.get("tanks",[]);var conveyors:Array=structures.get("conveyors",[]);if factories.is_empty() or tanks.is_empty() or conveyors.is_empty():return {}
	var sources:Array=[factories[0],tanks[0],conveyors[0]];var kinds:Array=["scrap","water","scrap"];var names:Array=["factory","tank","conveyor"];var resources:Array=[]
	for index in range(3):
		var source:Dictionary=sources[index];var spread:=maxf(1.4,(float(source.width) if index==0 else float(source.radius)*2.0 if index==1 else float(source.length))*.24)
		resources.append({"id":"industrial_salvage:%d:%d:%d"%[chunk_x,chunk_z,index],"kind":str(kinds[index]),"source":str(names[index]),"local_x":clampf(float(source.x)+RNG.signed(seed,chunk_x,chunk_z,1637+index)*spread,2.0,62.0),"local_z":clampf(float(source.z)+RNG.signed(seed,chunk_x,chunk_z,1651+index)*spread,2.0,62.0)})
	return {"resources":resources}
