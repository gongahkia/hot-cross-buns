extends SceneTree
const VEGETATION=preload("res://scripts/world_city_vegetation.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var massing:Dictionary={"buildings":[{"id":"building:a","x":20.0,"z":24.0,"height":18.0},{"id":"building:b","x":40.0,"z":35.0,"height":10.0}]};var failures:Dictionary={"failures":[{"building_id":"building:a","state":"intact","height_scale":1.0},{"building_id":"building:b","state":"collapsed","height_scale":.32}]};var urban:Dictionary={"ruin_age_years":150};var result:=VEGETATION.generate(20260730,4,-2,massing,failures,urban);var selected_seed:=20260730
	for seed in range(1,65):
		result=VEGETATION.generate(seed,4,-2,massing,failures,urban)
		if not (result.vegetation as Array).is_empty():selected_seed=seed;break
	_expect(not (result.vegetation as Array).is_empty() and (result.vegetation as Array).size()<=6,"vegetation succession fixture is empty or unbounded")
	for record:Dictionary in result.vegetation:_expect(str(record.stage)=="canopy" and str(record.placement) in ["roof","lot"] and float(record.height)==7.0 and float(record.base_height)>=0.0,"vegetation succession grammar drifted")
	_expect(result==VEGETATION.generate(selected_seed,4,-2,massing,failures,urban) and VEGETATION.generate(1,0,0,{},failures,urban).is_empty(),"vegetation succession is not deterministic")
	quit(1 if failed else 0)
