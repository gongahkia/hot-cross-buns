extends SceneTree
const FAR=preload("res://scripts/world_far_terrain.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var targets:=FAR.targets(Vector2i(3,-4),2)
	_expect(FAR.GRID==2 and targets.size()==96,"far terrain density drifted")
	_expect(not targets.has("3:-4") and not targets.has("5:-4") and targets.get("8:-4")==Vector2i(8,-4),"far terrain active-window boundary drifted")
	_expect(targets==FAR.targets(Vector2i(3,-4),2),"far terrain targets are not deterministic")
	quit(1 if failed else 0)
