extends SceneTree
const ARTERIALS=preload("res://scripts/world_city_arterials.gd")
const ROADS=preload("res://scripts/world_city_secondary_roads.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:Dictionary={"spine_axis":"x","terrain_slope":1.0};var urban:Dictionary={"land_use":"commercial","ruin_age_years":80};var first:=ROADS.generate(20260730,4,-2,ARTERIALS.generate(20260730,4,-2,layout),urban);var east:=ROADS.generate(20260730,5,-2,ARTERIALS.generate(20260730,5,-2,layout),urban)
	var x_offsets:=_offsets(first.roads,"x");var east_x_offsets:=_offsets(east.roads,"x")
	_expect(not first.is_empty() and (first.roads as Array).size()>=2 and x_offsets==east_x_offsets,"secondary-road seam drifted")
	for road:Dictionary in first.roads:_expect(str(road.kind) in ["secondary","alley"] and float(road.width)>0.0 and float(road.offset)>=8.0 and float(road.offset)<=56.0,"secondary-road record drifted")
	_expect(first==ROADS.generate(20260730,4,-2,ARTERIALS.generate(20260730,4,-2,layout),urban) and ROADS.generate(1,0,0,{},urban).is_empty(),"secondary roads are not deterministic")
	quit(1 if failed else 0)
func _offsets(roads:Array,axis:String)->Array:
	var result:Array=[]
	for road:Dictionary in roads:
		if str(road.axis)==axis:result.append([str(road.kind),float(road.offset)])
	return result
