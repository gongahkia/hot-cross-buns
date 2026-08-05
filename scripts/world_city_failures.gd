class_name WorldCityFailures
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,massing:Dictionary,urban:Dictionary)->Dictionary:
	if massing.is_empty() or urban.is_empty():return {}
	var failures:Array=[];var routes:Array=[];var age_factor:=clampf((float(urban.get("ruin_age_years",0))-40.0)/180.0,0.0,1.0)
	for index in range((massing.get("buildings",[]) as Array).size()):
		var building:Dictionary=(massing.buildings as Array)[index];var roll:=RNG.unit(seed,chunk_x,chunk_z,977+index);var state:="collapsed" if roll<.12+age_factor*.22 else "partial" if roll<.42+age_factor*.24 else "intact";var scale:=.32 if state=="collapsed" else .68 if state=="partial" else 1.0;var side_index:=RNG.hash_int(seed,chunk_x,chunk_z,997+index)%4;var side:="north" if side_index==0 else "east" if side_index==1 else "south" if side_index==2 else "west"
		failures.append({"building_id":str(building.id),"state":state,"height_scale":scale,"side":side})
		if state=="collapsed":routes.append({"building_id":str(building.id),"kind":"debris_steps","side":side,"step_count":3,"route_height":float(building.height)*scale})
	return {"failures":failures,"collapsed_routes":routes}
