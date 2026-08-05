extends SceneTree
const LAYOUT=preload("res://scripts/world_industrial_layout.gd")
const STRUCTURES=preload("res://scripts/world_industrial_structures.gd")
const RESOURCES=preload("res://scripts/world_industrial_resources.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:=LAYOUT.generate(20260730,4,-2,{"land_use":"manufacturing","ruin_age_years":160});var structures:=STRUCTURES.generate(20260730,4,-2,layout);var result:=RESOURCES.generate(20260730,4,-2,layout,structures)
	_expect((result.resources as Array).size()==3,"industrial salvage resources missing")
	for resource:Dictionary in result.resources:_expect(str(resource.id).begins_with("industrial_salvage:") and str(resource.kind) in ["scrap","water"] and str(resource.source) in ["factory","tank","conveyor"] and float(resource.local_x)>=2.0 and float(resource.local_x)<=62.0 and float(resource.local_z)>=2.0 and float(resource.local_z)<=62.0,"industrial salvage grammar drifted")
	_expect(str((result.resources as Array)[1].kind)=="water" and result==RESOURCES.generate(20260730,4,-2,layout,structures) and RESOURCES.generate(1,0,0,{},structures).is_empty(),"industrial salvage is not deterministic")
	(result.resources as Array)[0]["kind"]="changed";_expect(str((RESOURCES.generate(20260730,4,-2,layout,structures).resources as Array)[0].kind)=="scrap","industrial salvage leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="industrial_ruin":found=true;_expect(descriptor.industrial_resources==RESOURCES.generate(20260730,chunk_x,chunk_z,descriptor.industrial_layout,descriptor.industrial_structures),"industrial salvage descriptor wiring drifted");break
		if found:break
	_expect(found,"industrial salvage fixture found no industrial ruin")
	quit(1 if failed else 0)
