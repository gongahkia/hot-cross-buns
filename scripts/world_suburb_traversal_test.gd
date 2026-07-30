extends SceneTree
const ROADS=preload("res://scripts/world_suburb_roads.gd")
const PARCELS=preload("res://scripts/world_suburb_parcels.gd")
const TRANSITIONS=preload("res://scripts/world_suburb_transitions.gd")
const TRAVERSAL=preload("res://scripts/world_suburb_traversal.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"residential","ruin_age_years":90};var roads:=ROADS.generate(20260730,4,-2,urban);var parcels:=PARCELS.generate(20260730,4,-2,urban,roads);var transitions:=TRANSITIONS.generate(20260730,4,-2,parcels,roads);var result:=TRAVERSAL.generate(20260730,4,-2,parcels,transitions)
	_expect((result.roots as Array).size()==3 and (result.canopies as Array).size()==2 and (result.collapses as Array).size()==2,"suburb traversal records missing")
	for root:Dictionary in result.roots:_expect(str(root.id).begins_with("suburb_root:") and str(root.axis) in ["x","z"] and float(root.length)>=3.5 and float(root.width)>=.9 and float(root.height)>=.45,"suburb root grammar drifted")
	for canopy:Dictionary in result.canopies:_expect(str(canopy.id).begins_with("suburb_canopy:") and float(canopy.trunk_height)>=6.0 and float(canopy.platform_width)==3.2,"suburb canopy grammar drifted")
	for collapse:Dictionary in result.collapses:_expect(str(collapse.id).begins_with("suburb_collapse:") and str(collapse.axis) in ["x","z"] and float(collapse.length)>0.0 and float(collapse.height)>=.65,"suburb collapse grammar drifted")
	_expect(result==TRAVERSAL.generate(20260730,4,-2,parcels,transitions) and TRAVERSAL.generate(1,0,0,{},transitions).is_empty(),"suburb traversal is not deterministic")
	(result.roots as Array)[0]["height"]=0.0;_expect(float((TRAVERSAL.generate(20260730,4,-2,parcels,transitions).roots as Array)[0].height)>0.0,"suburb traversal leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="overgrown_suburb":found=true;_expect(descriptor.suburb_traversal==TRAVERSAL.generate(20260730,chunk_x,chunk_z,descriptor.suburb_parcels,descriptor.suburb_transitions),"suburb traversal descriptor wiring drifted");break
		if found:break
	_expect(found,"suburb traversal fixture found no overgrown suburb")
	quit(1 if failed else 0)
