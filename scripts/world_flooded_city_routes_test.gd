extends SceneTree
const ROUTES=preload("res://scripts/world_flooded_city_routes.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var basin:Dictionary={"shore_axis":"x"};var inundation:Dictionary={"inundation_depth":3.0};var first:=ROUTES.generate(20260730,4,-2,basin,inundation);var east:=ROUTES.generate(20260730,5,-2,basin,inundation)
	var canal:Dictionary=(first.canals as Array)[0];var bridge:Dictionary=(first.bridges as Array)[0];var roof:Dictionary=(first.roof_routes as Array)[0]
	_expect(str(canal.axis)=="x" and str(bridge.axis)=="z" and float(canal.width)==9.0 and float(bridge.length)==13.0 and float(roof.height)==7.0,"flooded route grammar drifted")
	_expect(is_equal_approx(float(canal.offset),float((east.canals as Array)[0].offset)) and first==ROUTES.generate(20260730,4,-2,basin,inundation),"flooded canal seam/determinism drifted")
	_expect(ROUTES.generate(1,0,0,{},inundation).is_empty(),"missing basin generated flooded routes")
	quit(1 if failed else 0)
