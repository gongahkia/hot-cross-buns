extends SceneTree
const LAYOUT=preload("res://scripts/world_industrial_layout.gd")
const STRUCTURES=preload("res://scripts/world_industrial_structures.gd")
const HAZARDS=preload("res://scripts/world_industrial_hazards.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:=LAYOUT.generate(20260730,4,-2,{"land_use":"manufacturing","ruin_age_years":160});var structures:=STRUCTURES.generate(20260730,4,-2,layout);var result:=HAZARDS.generate(20260730,4,-2,layout,structures)
	_expect((result.fields as Array).size()==2,"industrial contamination fields missing")
	for field:Dictionary in result.fields:_expect(str(field.id).begins_with("industrial_contamination:") and str(field.kind)=="contamination" and str(field.source) in ["factory","tank"] and float(field.local_x)>=3.0 and float(field.local_x)<=61.0 and float(field.local_z)>=3.0 and float(field.local_z)<=61.0 and float(field.radius)>2.4 and float(field.intensity)>=.35 and float(field.intensity)<.95,"industrial contamination grammar drifted")
	_expect(result==HAZARDS.generate(20260730,4,-2,layout,structures) and HAZARDS.generate(1,0,0,{},structures).is_empty(),"industrial contamination is not deterministic")
	(result.fields as Array)[0]["intensity"]=0.0;_expect(float((HAZARDS.generate(20260730,4,-2,layout,structures).fields as Array)[0].intensity)>0.0,"industrial contamination leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="industrial_ruin":found=true;_expect(descriptor.industrial_hazards==HAZARDS.generate(20260730,chunk_x,chunk_z,descriptor.industrial_layout,descriptor.industrial_structures),"industrial contamination descriptor wiring drifted");break
		if found:break
	_expect(found,"industrial contamination fixture found no industrial ruin")
	quit(1 if failed else 0)
