extends SceneTree
const LAYOUT=preload("res://scripts/world_industrial_layout.gd")
const STRUCTURES=preload("res://scripts/world_industrial_structures.gd")
const TRAVERSAL=preload("res://scripts/world_industrial_traversal.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:=LAYOUT.generate(20260730,4,-2,{"land_use":"manufacturing","ruin_age_years":160});var structures:=STRUCTURES.generate(20260730,4,-2,layout);var result:=TRAVERSAL.generate(20260730,4,-2,layout,structures)
	_expect((result.catwalks as Array).size()==2 and (result.access_routes as Array).size()==1,"industrial traversal records missing")
	for catwalk:Dictionary in result.catwalks:_expect(str(catwalk.id).begins_with("industrial_catwalk:") and str(catwalk.axis) in ["x","z"] and float(catwalk.length)>0.0 and float(catwalk.width)>0.0 and float(catwalk.height)>0.0,"industrial catwalk grammar drifted")
	var access:Dictionary=(result.access_routes as Array)[0];_expect(str(access.id).begins_with("industrial_access:") and str(access.axis) in ["x","z"] and absf(float(access.direction))==1.0 and float(access.run)==10.0 and float(access.rise)>0.0 and int(access.step_count)==5,"industrial access grammar drifted")
	_expect(result==TRAVERSAL.generate(20260730,4,-2,layout,structures) and TRAVERSAL.generate(1,0,0,{},structures).is_empty(),"industrial traversal is not deterministic")
	(result.catwalks as Array)[0]["height"]=0.0;_expect(float((TRAVERSAL.generate(20260730,4,-2,layout,structures).catwalks as Array)[0].height)>0.0,"industrial traversal leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="industrial_ruin":found=true;_expect(descriptor.industrial_traversal==TRAVERSAL.generate(20260730,chunk_x,chunk_z,descriptor.industrial_layout,descriptor.industrial_structures),"industrial traversal descriptor wiring drifted");break
		if found:break
	_expect(found,"industrial traversal fixture found no industrial ruin")
	quit(1 if failed else 0)
