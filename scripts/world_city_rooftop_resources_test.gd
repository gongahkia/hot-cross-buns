extends SceneTree
const ECOLOGY=preload("res://scripts/world_city_rooftop_resources.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var massing:Dictionary={"buildings":[{"id":"building:a","form":"courtyard","x":20.0,"z":24.0,"height":18.0},{"id":"building:b","form":"tower","x":40.0,"z":35.0,"height":10.0}]};var failures:Dictionary={"failures":[{"building_id":"building:a","state":"intact","height_scale":1.0},{"building_id":"building:b","state":"collapsed","height_scale":.32}]};var urban:Dictionary={"land_use":"commercial"};var result:=ECOLOGY.generate(20260730,4,-2,massing,failures,urban)
	var selected_seed:=20260730
	for seed in range(1,65):
		result=ECOLOGY.generate(seed,4,-2,massing,failures,urban)
		if not (result.resources as Array).is_empty():selected_seed=seed;break
	_expect(not (result.resources as Array).is_empty(),"rooftop ecology produced no selected fixture")
	for resource:Dictionary in result.resources:_expect(str(resource.kind) in ["food","water","scrap"] and str(resource.id).begins_with("rooftop:") and float(resource.roof_height)>0.0 and str(resource.id)!="rooftop:building:b","rooftop resource ecology drifted")
	_expect(result==ECOLOGY.generate(selected_seed,4,-2,massing,failures,urban) and ECOLOGY.generate(1,0,0,{},failures,urban).is_empty(),"rooftop resources are not deterministic")
	quit(1 if failed else 0)
