extends SceneTree
const SCHEDULER=preload("res://scripts/world_chunk_scheduler.gd")
var failed:=false
func _initialize()->void:
	var scheduler=SCHEDULER.new(20260730);var first:=scheduler.request(-1,2,0,2.0);var second:=scheduler.request(3,-4,1,1.0);var results:=scheduler.wait_for_all()
	_expect(results.size()==2 and int(results[0].token)==second and int(results[1].token)==first and str((results[0].descriptor as Dictionary).id)=="3:-4","threaded descriptor queue drifted")
	var cancelled:=scheduler.request(8,8);scheduler.cancel(cancelled);_expect(scheduler.wait_for_all().is_empty(),"cancelled queued request completed")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
