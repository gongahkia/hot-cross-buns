extends SceneTree
const CORRIDOR=preload("res://scripts/world_preload_corridor.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var east:=CORRIDOR.targets(Vector2i(3,-4),Vector2.RIGHT)
	var diagonal:=CORRIDOR.targets(Vector2i(3,-4),Vector2(1.0,-1.0))
	_expect(CORRIDOR.targets(Vector2i.ZERO,Vector2.ZERO).is_empty(),"stationary preload corridor is not empty")
	_expect(east.size()==24 and east.has("6:-5") and east.has("13:-3"),"cardinal preload corridor drifted")
	_expect(diagonal.size()==24 and diagonal.has("5:-8") and diagonal.has("12:-15") and diagonal.has("14:-13"),"diagonal preload corridor drifted")
	_expect(east==CORRIDOR.targets(Vector2i(3,-4),Vector2.RIGHT),"preload corridor is not deterministic")
	quit(1 if failed else 0)
