extends SceneTree
const STRUCTURES=preload("res://scripts/world_flooded_city_structures.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var result:=STRUCTURES.generate(20260730,4,-2,{"inundation_depth":3.0})
	_expect((result.structures as Array).size()==4,"flooded structures missing")
	for structure:Dictionary in result.structures:_expect(str(structure.collapse) in ["roof_only","partial","standing"] and float(structure.height_scale)>0.0 and float(structure.height_scale)<=1.0 and float(structure.submerged_depth)>=1.65 and float(structure.submerged_depth)<=3.0,"flooded collapse grammar drifted")
	_expect(result==STRUCTURES.generate(20260730,4,-2,{"inundation_depth":3.0}) and STRUCTURES.generate(1,0,0,{}).is_empty(),"flooded structures are not deterministic")
	quit(1 if failed else 0)
