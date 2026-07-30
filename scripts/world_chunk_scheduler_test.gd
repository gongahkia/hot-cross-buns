extends SceneTree
const SCHEDULER=preload("res://scripts/world_chunk_scheduler.gd")
var failed:=false
func _initialize()->void:
	var scheduler=SCHEDULER.new(20260730);var first:=scheduler.request(-1,2);var second:=scheduler.request(3,-4,1);var results:=scheduler.wait_for_all()
	_expect(results.size()==2 and int(results[0].token)==first and int(results[1].token)==second and str((results[0].descriptor as Dictionary).id)=="-1:2","threaded descriptor queue drifted")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
