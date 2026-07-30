extends SceneTree
const ROADS=preload("res://scripts/world_suburb_roads.gd")
const PARCELS=preload("res://scripts/world_suburb_parcels.gd")
const TRANSITIONS=preload("res://scripts/world_suburb_transitions.gd")
const TRAVERSAL=preload("res://scripts/world_suburb_traversal.gd")
const RESOURCES=preload("res://scripts/world_suburb_resources.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"residential","ruin_age_years":90};var roads:=ROADS.generate(20260730,4,-2,urban);var parcels:=PARCELS.generate(20260730,4,-2,urban,roads);var transitions:=TRANSITIONS.generate(20260730,4,-2,parcels,roads);var traversal:=TRAVERSAL.generate(20260730,4,-2,parcels,transitions);var result:=RESOURCES.generate(20260730,4,-2,parcels,traversal)
	_expect((result.resources as Array).size()==3,"suburb salvage resources missing")
	for resource:Dictionary in result.resources:_expect(str(resource.id).begins_with("suburb_salvage:") and str(resource.kind) in ["food","water","scrap"] and str(resource.source) in ["yard","home","collapse"] and float(resource.local_x)>=2.0 and float(resource.local_x)<=62.0 and float(resource.local_z)>=2.0 and float(resource.local_z)<=62.0,"suburb salvage grammar drifted")
	_expect(result==RESOURCES.generate(20260730,4,-2,parcels,traversal) and RESOURCES.generate(1,0,0,{},traversal).is_empty(),"suburb salvage is not deterministic")
	(result.resources as Array)[0]["kind"]="changed";_expect(str((RESOURCES.generate(20260730,4,-2,parcels,traversal).resources as Array)[0].kind)=="food","suburb salvage leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="overgrown_suburb":found=true;_expect(descriptor.suburb_resources==RESOURCES.generate(20260730,chunk_x,chunk_z,descriptor.suburb_parcels,descriptor.suburb_traversal),"suburb salvage descriptor wiring drifted");break
		if found:break
	_expect(found,"suburb salvage fixture found no overgrown suburb")
	quit(1 if failed else 0)
