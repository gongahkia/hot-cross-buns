extends SceneTree
const CORRIDORS=preload("res://scripts/world_city_corridors.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var sample_data:=generator.sample(float(chunk_x)*64.0+32.0,float(chunk_z)*64.0+32.0);var result:=CORRIDORS.generate(generator,chunk_x,chunk_z,sample_data)
			if result.is_empty():continue
			found=true;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z);_expect(descriptor.city_corridors==result,"city corridor descriptor wiring drifted")
			for corridor:Dictionary in result.corridors:_expect(str(corridor.id).begins_with("city_corridor:") and str(corridor.axis) in ["x","z"] and float(corridor.width)==9.0 and str(corridor.from_family)!="wilderness" and str(corridor.to_family)!="wilderness" and str(corridor.from_family)!=str(corridor.to_family),"city corridor grammar drifted")
			_expect(result==CORRIDORS.generate(generator,chunk_x,chunk_z,sample_data),"city corridor determinism drifted");break
		if found:break
	_expect(found,"city corridor fixture found no urban-family boundary")
	quit(1 if failed else 0)
