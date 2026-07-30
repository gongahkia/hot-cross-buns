extends SceneTree
const ARTERIALS=preload("res://scripts/world_city_arterials.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:Dictionary={"spine_axis":"x","terrain_slope":2.0};var first:=ARTERIALS.generate(20260730,4,-2,layout);var east:=ARTERIALS.generate(20260730,5,-2,layout)
	var roads:Array=first.arterials;var east_roads:Array=east.arterials;var tensor:Dictionary=first.tensor
	_expect(roads.size()==2 and str(roads[0].axis)=="x" and str(roads[1].axis)=="z" and float(roads[0].offset)>=10.0 and float(roads[0].offset)<=54.0,"arterial layout drifted")
	_expect(is_equal_approx(float(roads[0].offset),float(east_roads[0].offset)) and float(tensor.xx)>float(tensor.zz) and is_zero_approx(float(tensor.xz)),"tensor-guided arterial seam drifted")
	_expect(first==ARTERIALS.generate(20260730,4,-2,layout) and ARTERIALS.generate(1,0,0,{}).is_empty(),"arterial generation is not deterministic")
	quit(1 if failed else 0)
