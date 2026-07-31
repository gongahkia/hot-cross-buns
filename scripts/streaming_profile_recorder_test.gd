extends SceneTree

const RECORDER := preload("res://scripts/streaming_profile_recorder.gd")
var failed:=false

func _initialize()->void:
	var recorder=RECORDER.new()
	recorder.begin({"seed":7})
	recorder.record_sample(58.0,17.2,{"refresh":{"refresh_ms":12.0},"telemetry":{"hitches":1,"max_refresh_ms":28.0},"memory":{"static_memory_bytes":2048}},Vector3(1.0,2.0,3.0),{"id":"region:1","name":"Test","family":"wilderness"})
	recorder.record_hitch({"refresh_ms":28.0,"phases":{"active_chunk_build_ms":9.0}})
	var profile:Dictionary=recorder.finish()
	_expect(str(profile.schema)==RECORDER.SCHEMA,"profile schema drifted")
	_expect(int(profile.metadata.seed)==7 and (profile.samples as Array).size()==1 and (profile.hitches as Array).size()==1,"profile contents drifted")
	var parsed: Variant = JSON.parse_string(JSON.stringify(profile))
	_expect(parsed is Dictionary,"profile is not JSON serializable")
	_expect(recorder.finish().is_empty(),"finished recorder exported twice")
	quit(1 if failed else 0)

func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
