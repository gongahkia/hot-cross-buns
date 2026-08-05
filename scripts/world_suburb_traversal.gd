class_name WorldSuburbTraversal
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,parcels:Dictionary,transitions:Dictionary)->Dictionary:
	if parcels.is_empty() or transitions.is_empty():return {}
	var yards:Array=parcels.get("yards",[]);var homes:Array=parcels.get("homes",[]);if yards.size()<3 or homes.size()<2:return {}
	var roots:Array=[];var canopies:Array=[];var collapses:Array=[]
	for index in range(3):
		var yard:Dictionary=yards[index];var axis:="x" if RNG.unit(seed,chunk_x,chunk_z,1823+index)<.5 else "z";var extent:=(float(yard.width) if axis=="x" else float(yard.depth));roots.append({"id":"suburb_root:%d:%d:%d"%[chunk_x,chunk_z,index],"x":float(yard.x)+RNG.signed(seed,chunk_x,chunk_z,1841+index)*extent*.18,"z":float(yard.z)+RNG.signed(seed,chunk_x,chunk_z,1859+index)*extent*.18,"axis":axis,"length":maxf(3.5,extent*.48),"width":.9+RNG.unit(seed,chunk_x,chunk_z,1877+index)*.5,"height":.45+RNG.unit(seed,chunk_x,chunk_z,1891+index)*.45})
	for index in range(2):
		var yard:Dictionary=yards[index+1];canopies.append({"id":"suburb_canopy:%d:%d:%d"%[chunk_x,chunk_z,index],"x":float(yard.x)+RNG.signed(seed,chunk_x,chunk_z,1907+index)*float(yard.width)*.25,"z":float(yard.z)+RNG.signed(seed,chunk_x,chunk_z,1921+index)*float(yard.depth)*.25,"trunk_height":6.0+RNG.unit(seed,chunk_x,chunk_z,1937+index)*4.0,"platform_width":3.2,"platform_depth":3.2})
	for index in range(2):
		var home:Dictionary=homes[index];var axis:="z" if RNG.unit(seed,chunk_x,chunk_z,1951+index)<.5 else "x";var length:=(float(home.depth) if axis=="z" else float(home.width))*.8;collapses.append({"id":"suburb_collapse:%d:%d:%d"%[chunk_x,chunk_z,index],"x":float(home.x)+RNG.signed(seed,chunk_x,chunk_z,1967+index)*float(home.width)*.4,"z":float(home.z)+RNG.signed(seed,chunk_x,chunk_z,1981+index)*float(home.depth)*.4,"axis":axis,"length":length,"height":.65+RNG.unit(seed,chunk_x,chunk_z,1997+index)*.55})
	return {"roots":roots,"canopies":canopies,"collapses":collapses}
