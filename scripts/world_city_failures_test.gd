extends SceneTree
const FAILURES=preload("res://scripts/world_city_failures.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var massing:Dictionary={"buildings":[{"id":"building:a","width":8.0,"depth":10.0,"height":18.0},{"id":"building:b","width":12.0,"depth":9.0,"height":10.0}]};var urban:Dictionary={"ruin_age_years":210};var result:=FAILURES.generate(20260730,4,-2,massing,urban)
	_expect((result.failures as Array).size()==2,"structural failure records missing")
	for failure:Dictionary in result.failures:_expect(str(failure.state) in ["intact","partial","collapsed"] and float(failure.height_scale)>.0 and float(failure.height_scale)<=1.0 and str(failure.side) in ["north","east","south","west"],"structural failure grammar drifted")
	for route:Dictionary in result.collapsed_routes:_expect(str(route.kind)=="debris_steps" and int(route.step_count)==3 and float(route.route_height)>0.0,"collapsed-route grammar drifted")
	_expect(result==FAILURES.generate(20260730,4,-2,massing,urban) and FAILURES.generate(1,0,0,{},urban).is_empty(),"structural failures are not deterministic")
	quit(1 if failed else 0)
