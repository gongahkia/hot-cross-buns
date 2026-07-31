extends SceneTree

var failed:=false

func _initialize()->void:
	var main:Node3D=(load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main);await process_frame;main.start_level("expedition");await process_frame
	var streamer=main.world_streamer;var player=main.player;player.movement_enabled=false
	player.global_position+=Vector3(64.0,0.0,0.0)
	var peak_far:=0;var peak_features:=0
	for _frame in range(48):
		await process_frame
		var refresh:Dictionary=streamer.streaming_diagnostics().get("refresh",{})
		peak_far=maxi(peak_far,int(refresh.get("far_chunks_built",0)))
		peak_features=maxi(peak_features,int(refresh.get("feature_chunks_built",0)))
	_expect(streamer.chunks.size()==25,"runtime streaming did not restore the active window")
	_expect(peak_far<=streamer.FAR_CHUNKS_PER_FRAME,"runtime far-terrain budget drifted")
	_expect(peak_features<=streamer.FEATURE_CHUNKS_PER_FRAME,"runtime detail budget drifted")
	main.queue_free();await process_frame
	quit(1 if failed else 0)

func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
