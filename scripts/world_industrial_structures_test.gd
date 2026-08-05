extends SceneTree
const LAYOUT=preload("res://scripts/world_industrial_layout.gd")
const STRUCTURES=preload("res://scripts/world_industrial_structures.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:=LAYOUT.generate(20260730,4,-2,{"land_use":"manufacturing","ruin_age_years":160});var result:=STRUCTURES.generate(20260730,4,-2,layout)
	_expect((result.factories as Array).size()==1 and (result.tanks as Array).size()==2 and (result.gantries as Array).size()==1 and (result.pipes as Array).size()==2 and (result.conveyors as Array).size()==1,"industrial structure classes missing")
	var factory:Dictionary=(result.factories as Array)[0];_expect(str(factory.id).begins_with("industrial_factory:") and float(factory.width)>0.0 and float(factory.depth)>0.0 and float(factory.height)>=10.0,"industrial factory grammar drifted")
	for tank:Dictionary in result.tanks:_expect(str(tank.id).begins_with("industrial_tank:") and float(tank.radius)>=1.8 and float(tank.height)>=6.0,"industrial tank grammar drifted")
	for pipe:Dictionary in result.pipes:_expect(str(pipe.id).begins_with("industrial_pipe:") and str(pipe.axis) in ["x","z"] and float(pipe.length)>0.0 and float(pipe.height)>=4.5,"industrial pipe grammar drifted")
	_expect(str((result.gantries as Array)[0].axis) in ["x","z"] and float((result.gantries as Array)[0].span)>0.0 and str((result.conveyors as Array)[0].axis) in ["x","z"],"industrial gantry/conveyor grammar drifted")
	_expect(result==STRUCTURES.generate(20260730,4,-2,layout) and STRUCTURES.generate(1,0,0,{}).is_empty(),"industrial structures are not deterministic")
	(result.tanks as Array)[0]["radius"]=0.0;_expect(float((STRUCTURES.generate(20260730,4,-2,layout).tanks as Array)[0].radius)>0.0,"industrial structures leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="industrial_ruin":found=true;_expect(descriptor.industrial_structures==STRUCTURES.generate(20260730,chunk_x,chunk_z,descriptor.industrial_layout),"industrial structure descriptor wiring drifted");break
		if found:break
	_expect(found,"industrial structure fixture found no industrial ruin")
	quit(1 if failed else 0)
