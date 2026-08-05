extends SceneTree
const BASIN=preload("res://scripts/world_flooded_city_basin.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var generator=GENERATOR.new(20260730);var found:=false
	for region_z in range(-5,6):
		for region_x in range(-5,6):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="flooded_city":
				found=true;var basin:Dictionary=BASIN.sample(generator,chunk_x,chunk_z,generator.sample(float(chunk_x)*64.0+32.0,float(chunk_z)*64.0+32.0));_expect(descriptor.flood_basin==basin and str(basin.placement) in ["coastal_basin","inland_basin"] and str(basin.shore_axis) in ["x","z"] and int(basin.water_neighbors)>=0 and int(basin.water_neighbors)<=4 and float(basin.basin_depth)>=0.0,"flooded-city basin drifted");break
		if found:break
	_expect(found,"basin fixture found no flooded-city region")
	_expect(BASIN.sample(generator,0,0,{"region":{"family":"wilderness"}}).is_empty(),"wilderness received flooded-city basin")
	quit(1 if failed else 0)
