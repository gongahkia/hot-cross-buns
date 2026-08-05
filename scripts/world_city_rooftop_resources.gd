class_name WorldCityRooftopResources
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,massing:Dictionary,failures:Dictionary,urban:Dictionary)->Dictionary:
	if massing.is_empty() or failures.is_empty() or urban.is_empty():return {}
	var failure_map:Dictionary={};var resources:Array=[]
	for failure:Dictionary in failures.get("failures",[]):failure_map[str(failure.building_id)]=failure
	for index in range((massing.get("buildings",[]) as Array).size()):
		var building:Dictionary=(massing.buildings as Array)[index];var failure:Dictionary=failure_map.get(str(building.id),{});if str(failure.get("state",""))=="collapsed" or RNG.unit(seed,chunk_x,chunk_z,1021+index)<=.48:continue
		var roll:=RNG.unit(seed,chunk_x,chunk_z,1049+index);var kind:="food" if str(building.form)=="courtyard" else "water" if roll<.5 else "scrap";resources.append({"id":"rooftop:%s"%str(building.id),"kind":kind,"x":float(building.x),"z":float(building.z),"roof_height":float(building.height)*float(failure.get("height_scale",1.0))})
	return {"resources":resources}
