extends SceneTree
const TRAVERSAL=preload("res://scripts/world_city_traversal.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var massing:Dictionary={"buildings":[{"id":"building:a","form":"tower","x":20.0,"z":24.0,"width":8.0,"depth":10.0,"height":18.0},{"id":"building:b","form":"courtyard","x":40.0,"z":35.0,"width":12.0,"depth":9.0,"height":10.0}]};var result:=TRAVERSAL.generate(20260730,4,-2,massing)
	_expect((result.facades as Array).size()==2 and (result.roofs as Array).size()==2,"facade/roof traversal records missing")
	for facade:Dictionary in result.facades:_expect(str(facade.side) in ["north","east","south","west"] and float(facade.ledge_height)>=2.0 and float(facade.ledge_width)>=2.0,"facade traversal grammar drifted")
	_expect(str((result.roofs as Array)[0].kind)=="mechanical" and str((result.roofs as Array)[1].kind)=="garden","roof traversal grammar drifted")
	_expect(result==TRAVERSAL.generate(20260730,4,-2,massing) and TRAVERSAL.generate(1,0,0,{}).is_empty(),"facade/roof traversal is not deterministic")
	quit(1 if failed else 0)
