extends SceneTree
const ROADS=preload("res://scripts/world_suburb_roads.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"residential","ruin_age_years":90};var result:=ROADS.generate(20260730,4,-2,urban);var collector:Dictionary=result.collector
	_expect(str(collector.axis) in ["x","z"] and float(collector.offset)>=12.0 and float(collector.offset)<=52.0 and float(collector.width)==4.4 and (result.local_roads as Array).size()==1 and (result.culdesacs as Array).size()==2,"suburb road hierarchy missing")
	for culdesac:Dictionary in result.culdesacs:_expect(str(culdesac.id).begins_with("suburb_culdesac:") and str(culdesac.axis) in ["x","z"] and float(culdesac.x)>=12.0 and float(culdesac.x)<=52.0 and float(culdesac.z)>=12.0 and float(culdesac.z)<=52.0 and float(culdesac.radius)==4.0,"suburb culdesac grammar drifted")
	var neighbor:=ROADS.generate(20260730,5,-2,urban) if str(collector.axis)=="x" else ROADS.generate(20260730,4,-1,urban);_expect(result==ROADS.generate(20260730,4,-2,urban) and ROADS.generate(1,0,0,{"land_use":"manufacturing"}).is_empty() and is_equal_approx(float(collector.offset),float(neighbor.collector.offset)),"suburb road determinism/seam drifted")
	(result.culdesacs as Array)[0]["radius"]=0.0;_expect(float((ROADS.generate(20260730,4,-2,urban).culdesacs as Array)[0].radius)==4.0,"suburb roads leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="overgrown_suburb":found=true;_expect(descriptor.suburb_roads==ROADS.generate(20260730,chunk_x,chunk_z,descriptor.urban),"suburb road descriptor wiring drifted");break
		if found:break
	_expect(found,"suburb road fixture found no overgrown suburb")
	quit(1 if failed else 0)
