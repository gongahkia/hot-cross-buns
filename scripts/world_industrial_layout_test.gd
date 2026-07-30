extends SceneTree
const LAYOUT=preload("res://scripts/world_industrial_layout.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"manufacturing","ruin_age_years":160};var result:=LAYOUT.generate(20260730,4,-2,urban)
	_expect(str(result.zone)=="manufacturing" and str(result.service_axis) in ["x","z"] and int(result.ruin_age_years)==160 and (result.sites as Array).size()==4,"industrial layout records missing")
	for site:Dictionary in result.sites:_expect(str(site.id).begins_with("industrial_site:") and str(site.program) in ["factory","assembly","warehouse","yard"] and float(site.x)-float(site.width)*.5>=0.0 and float(site.x)+float(site.width)*.5<=64.0 and float(site.z)-float(site.depth)*.5>=0.0 and float(site.z)+float(site.depth)*.5<=64.0 and str(site.orientation)==str(result.service_axis),"industrial site bounds drifted")
	_expect(result==LAYOUT.generate(20260730,4,-2,urban) and LAYOUT.generate(1,0,0,{"land_use":"residential"}).is_empty(),"industrial layout is not deterministic")
	(result.sites as Array)[0]["program"]="changed";_expect(str((LAYOUT.generate(20260730,4,-2,urban).sites as Array)[0].program)!="changed","industrial layout leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="industrial_ruin":found=true;_expect(descriptor.industrial_layout==LAYOUT.generate(20260730,chunk_x,chunk_z,descriptor.urban),"industrial layout descriptor wiring drifted");break
		if found:break
	_expect(found,"industrial layout fixture found no industrial ruin")
	quit(1 if failed else 0)
