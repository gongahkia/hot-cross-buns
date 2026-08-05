extends SceneTree
const ORIGIN=preload("res://scripts/world_origin.gd")
var failed:=false
func _initialize()->void:
	var origin=ORIGIN.new(64.0);var local:=Vector3(2048.0,3.0,-2112.0);var world:=origin.world_position(local);var delta:=origin.rebase_delta(local);var rebased:=local+delta
	_expect(origin.origin_chunk==Vector2i(32,-33) and origin.world_position(rebased).is_equal_approx(world) and origin.local_chunk_position(Vector2i(32,-33))==Vector3.ZERO,"origin rebase drifted")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
