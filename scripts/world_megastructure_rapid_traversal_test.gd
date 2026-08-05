extends SceneTree

const CHUNK_SIZE := 64.0
const LAPS := 3
const STEP_DISTANCE := 32.0

var failed := false

func _initialize() -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("expedition")
	await process_frame
	var streamer = main.world_streamer
	var player = main.player
	player.movement_enabled = false
	var route := _baseline_route(main.megastructure_descriptor.get("routes", []))
	var samples := _samples(route)
	_expect(samples.size() >= 20, "opening-sector soak fixture is too short")
	var peaks := {"active":0,"collision":0,"far":0,"features":0}
	for lap in range(LAPS):
		for canonical: Vector3 in samples + _reversed(samples):
			player.global_position = canonical - Vector3(float(streamer.origin.origin_chunk.x) * CHUNK_SIZE, 0.0, float(streamer.origin.origin_chunk.y) * CHUNK_SIZE)
			await process_frame
			peaks = _capture(streamer, peaks)
			_expect(streamer.origin.world_position(player.global_position).distance_to(canonical) < 0.01, "rapid opening traversal changed canonical position")
	streamer.refresh(true)
	var final_chunk: Vector2i = streamer.origin.chunk_at_local(player.global_position)
	var final_root := streamer.chunks.get("%d:%d" % [final_chunk.x, final_chunk.y]) as Node3D
	_expect(final_root != null and final_root.get_node_or_null("MegastructureShell") != null and final_root.get_node_or_null("MegastructureCollision") != null and final_root.get_node_or_null("MegastructureTraversal") != null, "rapid opening traversal lost streamed megastructure phases")
	_expect(streamer.chunks.size() == 25 and int(peaks.active) <= streamer.ACTIVE_CHUNKS_PER_FRAME and int(peaks.collision) <= streamer.COLLISION_LODS_PER_FRAME and int(peaks.far) <= streamer.FAR_CHUNKS_PER_FRAME and int(peaks.features) <= streamer.FEATURE_CHUNKS_PER_FRAME, "rapid opening traversal exceeded streaming budgets")
	main.queue_free()
	await process_frame
	quit(1 if failed else 0)

func _baseline_route(routes: Array) -> Dictionary:
	for route: Dictionary in routes:
		if str(route.get("route_class", "")) == "baseline":
			return route
	return {}

func _samples(route: Dictionary) -> Array:
	var points: Array = [route.get("start_anchor", [])]
	for waypoint in route.get("waypoints", []):
		points.append(waypoint)
	points.append(route.get("end_anchor", []))
	var samples: Array = []
	for index in range(points.size() - 1):
		var start: Array = points[index]
		var finish: Array = points[index + 1]
		var first := Vector3(float(start[0]), float(start[1]) + 1.55, float(start[2]))
		var last := Vector3(float(finish[0]), float(finish[1]) + 1.55, float(finish[2]))
		var count := maxi(1, ceili(first.distance_to(last) / STEP_DISTANCE))
		for step in range(count):
			samples.append(first.lerp(last, float(step) / float(count)))
	samples.append(Vector3(float(points[points.size() - 1][0]), float(points[points.size() - 1][1]) + 1.55, float(points[points.size() - 1][2])))
	return samples

func _reversed(points: Array) -> Array:
	var result := points.duplicate()
	result.reverse()
	return result

func _capture(streamer, peaks: Dictionary) -> Dictionary:
	var refresh: Dictionary = streamer.streaming_diagnostics().get("refresh", {})
	var active := int(refresh.get("active_chunks_built", 0))
	var collision := int(refresh.get("collision_lods_built", 0))
	var far := int(refresh.get("far_chunks_built", 0))
	var features := int(refresh.get("feature_chunks_built", 0))
	_expect(not (active > 0 and (collision > 0 or far > 0 or features > 0)), "rapid opening traversal combined active construction with a heavy category")
	_expect(not (collision > 0 and (far > 0 or features > 0)), "rapid opening traversal combined collision construction with a background category")
	return {"active":maxi(int(peaks.active), active),"collision":maxi(int(peaks.collision), collision),"far":maxi(int(peaks.far), far),"features":maxi(int(peaks.features), features)}

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
