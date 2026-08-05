extends SceneTree

const CHUNK_SIZE := 64.0
const LAPS := 3
const MEMORY_GROWTH_ALLOWANCE := 1_048_576
var failed := false

func _initialize() -> void:
	if OS.get_name() != "macOS":
		quit()
		return
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("expedition")
	await physics_frame
	var settled_memory := -1
	var rebases := 0
	var previous_origin: Vector2i = main.world_streamer.origin.origin_chunk
	for lap in range(LAPS):
		for chunk_x in _route():
			var streamer = main.world_streamer
			var player = main.player
			var canonical := Vector3(float(chunk_x) * CHUNK_SIZE + CHUNK_SIZE * 0.5, player.global_position.y, CHUNK_SIZE * 0.5)
			player.movement_enabled = false
			player.global_position = canonical - Vector3(float(streamer.origin.origin_chunk.x) * CHUNK_SIZE,0.0,float(streamer.origin.origin_chunk.y) * CHUNK_SIZE)
			streamer.refresh(true)
			await physics_frame
			if streamer.origin.origin_chunk != previous_origin:
				rebases += 1
				previous_origin = streamer.origin.origin_chunk
			var memory: Dictionary = streamer.chunk_memory_snapshot()
			_expect(streamer.chunks.size() == 25 and streamer.far_chunks.size() == 96 and streamer.pending_chunks.size() <= 24, "macOS streaming window drifted on lap %d: %d/%d/%d" % [lap,streamer.chunks.size(),streamer.far_chunks.size(),streamer.pending_chunks.size()])
			_expect(streamer.chunk_cache.size() <= streamer.chunk_cache.capacity and int(memory.minimum_payload_bytes) > 0, "macOS streaming cache drifted on lap %d" % lap)
		main.photo_mode.toggle()
		_expect(main.photo_mode.active and not main.hud.visible, "macOS photo-mode entry drifted on lap %d" % lap)
		main.photo_mode.toggle()
		_expect(not main.photo_mode.active and main.hud.visible, "macOS photo-mode exit drifted on lap %d" % lap)
		var current_memory := int(main.world_streamer.chunk_memory_snapshot().static_memory_bytes)
		if settled_memory < 0:
			settled_memory = current_memory
		else:
			_expect(current_memory <= int(float(settled_memory) * 1.1) + MEMORY_GROWTH_ALLOWANCE, "macOS retained memory grew after return lap %d" % lap)
	_expect(rebases >= LAPS * 2, "macOS long-run route did not repeatedly rebase")
	main.queue_free()
	await process_frame
	quit(1 if failed else 0)

func _route() -> Array[int]:
	var route: Array[int] = []
	for chunk_x in range(-64,65,8): route.append(chunk_x)
	for chunk_x in range(56,-65,-8): route.append(chunk_x)
	return route

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
