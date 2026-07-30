class_name WorldSuburbResources
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,parcels:Dictionary,traversal:Dictionary)->Dictionary:
	if parcels.is_empty() or traversal.is_empty():return {}
	var yards:Array=parcels.get("yards",[]);var homes:Array=parcels.get("homes",[]);var collapses:Array=traversal.get("collapses",[]);if yards.is_empty() or homes.is_empty() or collapses.is_empty():return {}
	var sources:Array=[yards[0],homes[1],collapses[0]];var kinds:Array=["food","water","scrap"];var names:Array=["yard","home","collapse"];var resources:Array=[]
	for index in range(3):
		var source:Dictionary=sources[index];var spread:=maxf(1.2,(float(source.width) if source.has("width") else float(source.length))*.22)
		resources.append({"id":"suburb_salvage:%d:%d:%d"%[chunk_x,chunk_z,index],"kind":str(kinds[index]),"source":str(names[index]),"local_x":clampf(float(source.x)+RNG.signed(seed,chunk_x,chunk_z,2011+index)*spread,2.0,62.0),"local_z":clampf(float(source.z)+RNG.signed(seed,chunk_x,chunk_z,2027+index)*spread,2.0,62.0)})
	return {"resources":resources}
