class_name WorldFloodedCityEcology
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,inundation:Dictionary,fields:Dictionary)->Dictionary:
	if inundation.is_empty() or fields.is_empty():return {}
	var structures:Array=fields.get("structures",[]);if structures.is_empty():return {}
	var depth:=float(inundation.get("inundation_depth",0.0));var resources:Array=[];var hazards:Array=[]
	for index in range(mini(2,structures.size())):
		var structure:Dictionary=structures[index];var half_x:=maxf(.75,float(structure.width)*.5-1.0);var half_z:=maxf(.75,float(structure.depth)*.5-1.0);var roll:=RNG.unit(seed,chunk_x,chunk_z,1321+index);var kind:="food" if roll<.42 else "water" if roll<.78 else "scrap";var support_height:=maxf(1.0,float(structure.height)*float(structure.height_scale)-float(structure.submerged_depth)*.12)
		resources.append({"id":"aquatic_resource:%d:%d:%d"%[chunk_x,chunk_z,index],"kind":kind,"local_x":float(structure.x)+(RNG.unit(seed,chunk_x,chunk_z,1337+index)*2.0-1.0)*half_x,"local_z":float(structure.z)+(RNG.unit(seed,chunk_x,chunk_z,1351+index)*2.0-1.0)*half_z,"support_height":support_height})
	for index in range(2):
		var kind:="deep_water" if depth>=2.4 and index==0 else "current";var strength:=Vector2(float(inundation.get("current_x",0.0)),float(inundation.get("current_z",0.0))).length()
		hazards.append({"id":"aquatic_hazard:%d:%d:%d"%[chunk_x,chunk_z,index],"kind":kind,"local_x":8.0+RNG.unit(seed,chunk_x,chunk_z,1367+index)*48.0,"local_z":8.0+RNG.unit(seed,chunk_x,chunk_z,1381+index)*48.0,"radius":1.8+depth*.45+RNG.unit(seed,chunk_x,chunk_z,1399+index)*1.4,"current_x":float(inundation.get("current_x",0.0)),"current_z":float(inundation.get("current_z",0.0)),"strength":strength})
	return {"resources":resources,"hazards":hazards}
