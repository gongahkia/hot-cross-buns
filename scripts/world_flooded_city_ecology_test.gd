extends SceneTree
const ECOLOGY=preload("res://scripts/world_flooded_city_ecology.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var inundation:Dictionary={"inundation_depth":3.0,"current_x":.7,"current_z":0.0};var fields:Dictionary={"structures":[{"x":20.0,"z":22.0,"width":8.0,"depth":10.0,"height":16.0,"height_scale":1.0,"submerged_depth":2.4},{"x":42.0,"z":38.0,"width":12.0,"depth":8.0,"height":12.0,"height_scale":.62,"submerged_depth":1.8}]};var result:=ECOLOGY.generate(20260730,4,-2,inundation,fields)
	_expect((result.resources as Array).size()==2 and (result.hazards as Array).size()==2,"flooded ecology records missing")
	for resource:Dictionary in result.resources:_expect(str(resource.id).begins_with("aquatic_resource:") and str(resource.kind) in ["food","water","scrap"] and float(resource.local_x)>=0.0 and float(resource.local_x)<=64.0 and float(resource.local_z)>=0.0 and float(resource.local_z)<=64.0 and float(resource.support_height)>=1.0,"aquatic resource grammar drifted")
	for hazard:Dictionary in result.hazards:_expect(str(hazard.id).begins_with("aquatic_hazard:") and str(hazard.kind) in ["current","deep_water"] and float(hazard.radius)>1.8 and is_equal_approx(float(hazard.strength),.7),"aquatic hazard grammar drifted")
	_expect(str((result.hazards as Array)[0].kind)=="deep_water" and str((result.hazards as Array)[1].kind)=="current","aquatic hazard depth classification drifted")
	_expect(result==ECOLOGY.generate(20260730,4,-2,inundation,fields) and ECOLOGY.generate(1,0,0,{},fields).is_empty() and ECOLOGY.generate(1,0,0,inundation,{}).is_empty(),"flooded ecology is not deterministic")
	(result.resources as Array)[0]["kind"]="changed";_expect(str((ECOLOGY.generate(20260730,4,-2,inundation,fields).resources as Array)[0].kind)!="changed","flooded ecology leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="flooded_city":found=true;_expect(descriptor.flood_ecology==ECOLOGY.generate(20260730,chunk_x,chunk_z,descriptor.flood_inundation,descriptor.flood_structures),"flooded ecology descriptor wiring drifted");break
		if found:break
	_expect(found,"flooded ecology fixture found no flooded city")
	quit(1 if failed else 0)
