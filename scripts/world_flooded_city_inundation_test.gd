extends SceneTree
const INUNDATION=preload("res://scripts/world_flooded_city_inundation.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var x_field:=INUNDATION.generate(20260730,4,-2,{"shore_axis":"x","basin_depth":3.0});var z_field:=INUNDATION.generate(20260730,4,-2,{"shore_axis":"z","basin_depth":3.0})
	_expect(float(x_field.inundation_depth)>=.5 and not is_zero_approx(float(x_field.current_x)) and is_zero_approx(float(x_field.current_z)),"x-shore inundation/current drifted")
	_expect(not is_zero_approx(float(z_field.current_z)) and is_zero_approx(float(z_field.current_x)),"z-shore inundation/current drifted")
	_expect(x_field==INUNDATION.generate(20260730,4,-2,{"shore_axis":"x","basin_depth":3.0}) and INUNDATION.generate(1,0,0,{}).is_empty(),"inundation field is not deterministic")
	quit(1 if failed else 0)
