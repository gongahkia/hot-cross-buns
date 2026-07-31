extends SceneTree

var failed:=false

func _initialize()->void:
	var main:Node3D=(load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main);await process_frame;main.start_level("expedition");await process_frame
	var streamer=main.world_streamer;var player=main.player;player.movement_enabled=false
	var entry_chunk:Vector2i=streamer.origin.chunk_at_local(player.global_position)
	var entry_root:=streamer.chunks.get("%d:%d"%[entry_chunk.x,entry_chunk.y]) as Node3D
	_expect(entry_root!=null and entry_root.get_node_or_null("MegastructureShell")!=null and entry_root.get_node_or_null("MegastructureCollision")!=null and entry_root.get_node_or_null("MegastructureTraversal")!=null,"entry streaming phases missing")
	player.global_position+=Vector3(64.0,0.0,0.0)
	var peak_active:=0;var peak_collision:=0;var peak_far:=0;var peak_features:=0
	for _frame in range(48):
		await process_frame
		var peaks:=_capture(streamer,peak_active,peak_collision,peak_far,peak_features)
		peak_active=int(peaks.active);peak_collision=int(peaks.collision);peak_far=int(peaks.far);peak_features=int(peaks.features)
	var reveal:Dictionary=(main.megastructure_descriptor.get("reveals",[]) as Array)[0]
	var anchor:Array=reveal.get("recommended_view_anchor",[])
	var canonical:=Vector3(float(anchor[0]),25.55,float(anchor[2]))
	player.global_position=canonical-Vector3(float(streamer.origin.origin_chunk.x)*64.0,0.0,float(streamer.origin.origin_chunk.y)*64.0)
	var reveal_chunk:Vector2i=streamer.origin.chunk_at_local(player.global_position)
	_expect(streamer.generator.megastructure_reveal_priority(reveal_chunk.x,reveal_chunk.y)>0.0,"first reveal did not receive priority")
	for _frame in range(72):
		await process_frame
		var peaks:=_capture(streamer,peak_active,peak_collision,peak_far,peak_features)
		peak_active=int(peaks.active);peak_collision=int(peaks.collision);peak_far=int(peaks.far);peak_features=int(peaks.features)
	var reveal_root:=streamer.chunks.get("%d:%d"%[reveal_chunk.x,reveal_chunk.y]) as Node3D
	_expect(reveal_root!=null and reveal_root.get_node_or_null("MegastructureShell")!=null and reveal_root.get_node_or_null("MegastructureCollision")!=null,"first reveal streaming phases missing")
	_expect(streamer.chunks.size()==25,"runtime streaming did not restore the active window")
	_expect(peak_active<=streamer.ACTIVE_CHUNKS_PER_FRAME,"runtime active-chunk budget drifted")
	_expect(peak_collision<=streamer.COLLISION_LODS_PER_FRAME,"runtime collision budget drifted")
	_expect(peak_far<=streamer.FAR_CHUNKS_PER_FRAME,"runtime far-terrain budget drifted")
	_expect(peak_features<=streamer.FEATURE_CHUNKS_PER_FRAME,"runtime detail budget drifted")
	main.queue_free();await process_frame
	quit(1 if failed else 0)

func _capture(streamer,peak_active:int,peak_collision:int,peak_far:int,peak_features:int)->Dictionary:
	var refresh:Dictionary=streamer.streaming_diagnostics().get("refresh",{})
	var active:=int(refresh.get("active_chunks_built",0));var collision:=int(refresh.get("collision_lods_built",0));var far:=int(refresh.get("far_chunks_built",0));var features:=int(refresh.get("feature_chunks_built",0))
	_expect(not (active>0 and (collision>0 or far>0 or features>0)),"runtime streaming combined active construction with a heavy category")
	_expect(not (collision>0 and (far>0 or features>0)),"runtime streaming combined collision construction with a background category")
	return {"active":maxi(peak_active,active),"collision":maxi(peak_collision,collision),"far":maxi(peak_far,far),"features":maxi(peak_features,features)}

func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
