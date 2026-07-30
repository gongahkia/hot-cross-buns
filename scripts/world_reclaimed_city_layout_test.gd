extends SceneTree
const LAYOUT=preload("res://scripts/world_reclaimed_city_layout.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var generator=GENERATOR.new(20260730);var found:=false
	for region_z in range(-5,6):
		for region_x in range(-5,6):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="reclaimed_city":
				found=true;var layout:Dictionary=LAYOUT.sample(generator,chunk_x,chunk_z,generator.sample(float(chunk_x)*64.0+32.0,float(chunk_z)*64.0+32.0))
				_expect(descriptor.city_layout==layout and str(layout.layout) in ["waterfront_grid","contour_terrace","orthogonal_grid"] and str(layout.spine_axis) in ["x","z"] and float(layout.terrain_slope)>=0.0,"reclaimed-city macro layout drifted");break
		if found:break
	_expect(found,"macro-layout fixture found no reclaimed-city region")
	_expect(LAYOUT.sample(generator,0,0,{"region":{"family":"wilderness"}}).is_empty(),"wilderness received reclaimed-city layout")
	quit(1 if failed else 0)
