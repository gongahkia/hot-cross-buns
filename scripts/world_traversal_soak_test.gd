extends SceneTree
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var main=(load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main);await process_frame;main.start_level("expedition");await process_frame
	var streamer=main.world_streamer;var player=main.player;var generator=GENERATOR.new(int(main.current_level.seed));player.movement_enabled=false
	var rebases:=0;var previous_origin:Vector2i=streamer.origin.origin_chunk
	for chunk_x in _route():
		var canonical:=Vector3(float(chunk_x)*64.0+32.0,player.global_position.y,32.0)
		player.global_position=canonical-Vector3(float(streamer.origin.origin_chunk.x)*64.0,0.0,float(streamer.origin.origin_chunk.y)*64.0)
		streamer.refresh(true);await process_frame
		if streamer.origin.origin_chunk!=previous_origin:rebases+=1;previous_origin=streamer.origin.origin_chunk
		var sample:Dictionary=streamer.sample_at(player.global_position);var expected:Dictionary=generator.sample(canonical.x,canonical.z)
		_expect(streamer.chunks.size()==25 and streamer.far_chunks.size()==96,"streaming window drifted at chunk %d"%chunk_x)
		_expect(streamer.chunks.has("%d:0"%chunk_x) and int((streamer.chunks["%d:0"%chunk_x] as Node3D).get_meta("collision_grid",0))==16,"center collision missing at chunk %d"%chunk_x)
		_expect(streamer.chunk_cache.size()<=streamer.chunk_cache.capacity,"chunk cache exceeded capacity")
		_expect(is_equal_approx(float(sample.elevation),float(expected.elevation)) and sample.region==expected.region,"canonical sample drifted at chunk %d"%chunk_x)
	_expect(rebases>0,"long traversal did not exercise floating-origin rebasing")
	main.queue_free();await process_frame
	quit(1 if failed else 0)

func _route()->Array[int]:
	var route:Array[int]=[]
	for chunk_x in range(-64,65,8):route.append(chunk_x)
	for chunk_x in range(56,-65,-8):route.append(chunk_x)
	return route
