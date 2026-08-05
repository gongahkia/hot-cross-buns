extends SceneTree
const ROADS=preload("res://scripts/world_suburb_roads.gd")
const PARCELS=preload("res://scripts/world_suburb_parcels.gd")
const TRANSITIONS=preload("res://scripts/world_suburb_transitions.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"residential","ruin_age_years":90};var roads:=ROADS.generate(20260730,4,-2,urban);var parcels:=PARCELS.generate(20260730,4,-2,urban,roads);var result:=TRANSITIONS.generate(20260730,4,-2,parcels,roads)
	_expect((result.entries as Array).size()==4 and (result.interiors as Array).size()==4,"suburb transition records missing")
	for entry:Dictionary in result.entries:_expect(str(entry.id).begins_with("suburb_entry:") and str(entry.side) in ["north","east","south","west"] and float(entry.x)>=0.0 and float(entry.x)<=64.0 and float(entry.z)>=0.0 and float(entry.z)<=64.0 and float(entry.width)==1.6 and float(entry.porch_depth)==2.4,"suburb entry grammar drifted")
	for interior:Dictionary in result.interiors:_expect(str(interior.id).begins_with("suburb_interior:") and str(interior.entry_id).begins_with("suburb_entry:") and float(interior.clear_width)==1.6,"suburb interior grammar drifted")
	_expect(result==TRANSITIONS.generate(20260730,4,-2,parcels,roads) and TRANSITIONS.generate(1,0,0,{},roads).is_empty(),"suburb transitions are not deterministic")
	(result.entries as Array)[0]["side"]="changed";_expect(str((TRANSITIONS.generate(20260730,4,-2,parcels,roads).entries as Array)[0].side)!="changed","suburb transitions leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="overgrown_suburb":found=true;_expect(descriptor.suburb_transitions==TRANSITIONS.generate(20260730,chunk_x,chunk_z,descriptor.suburb_parcels,descriptor.suburb_roads),"suburb transition descriptor wiring drifted");break
		if found:break
	_expect(found,"suburb transition fixture found no overgrown suburb")
	quit(1 if failed else 0)
