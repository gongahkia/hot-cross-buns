extends SceneTree
const TELEMETRY=preload("res://scripts/world_streaming_telemetry.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var telemetry=TELEMETRY.new(5.0,2);var context:Dictionary={"active":25,"pending":4,"cached":31}
	_expect(telemetry.record_refresh(4.9,context).is_empty(),"sub-threshold refresh became a hitch")
	var first:=telemetry.record_refresh(5.0,context);context["active"]=0
	telemetry.record_refresh(6.0,{"active":24});var last:=telemetry.record_refresh(7.0,{"active":23});var summary:=telemetry.summary()
	_expect(int(first.active)==25 and int(last.active)==23,"hitch context was not copied")
	_expect(int(summary.samples)==4 and int(summary.hitches)==3 and is_equal_approx(float(summary.max_refresh_ms),7.0),"hitch aggregates drifted")
	_expect((summary.recent_hitches as Array).size()==2 and int((summary.recent_hitches as Array)[0].active)==24,"hitch ring capacity drifted")
	quit(1 if failed else 0)
