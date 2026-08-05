class_name WorldCityVegetation
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const MAX_RECORDS:=6

static func generate(seed:int,chunk_x:int,chunk_z:int,massing:Dictionary,failures:Dictionary,urban:Dictionary)->Dictionary:
	if massing.is_empty() or failures.is_empty() or urban.is_empty():return {}
	var failure_map:Dictionary={};var vegetation:Array=[];var age:=int(urban.get("ruin_age_years",0));var stage:="pioneer" if age<80 else "shrub" if age<140 else "canopy";var height:=2.5 if stage=="pioneer" else 4.5 if stage=="shrub" else 7.0
	for failure:Dictionary in failures.get("failures",[]):failure_map[str(failure.building_id)]=failure
	for index in range((massing.get("buildings",[]) as Array).size()):
		if vegetation.size()>=MAX_RECORDS:break
		var building:Dictionary=(massing.buildings as Array)[index];var failure:Dictionary=failure_map.get(str(building.id),{});if RNG.unit(seed,chunk_x,chunk_z,1069+index)<=.36:continue
		var roof:=str(failure.get("state",""))!="collapsed";vegetation.append({"id":"vegetation:%s"%str(building.id),"stage":stage,"placement":"roof" if roof else "lot","x":float(building.x),"z":float(building.z),"base_height":float(building.height)*float(failure.get("height_scale",1.0)) if roof else 0.0,"height":height})
	return {"vegetation":vegetation}
