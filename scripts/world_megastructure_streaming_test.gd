extends SceneTree

const GENERATOR := preload("res://scripts/world_generator.gd")
const MEGASTRUCTURE_GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const SCHEDULER := preload("res://scripts/world_chunk_scheduler.gd")
const MAIN_SCENE_PATH := "res://scenes/main.tscn"

const SEED := 20260730

var failed := false

func _initialize() -> void:
	_assert_descriptor_and_worker_contract()
	await _assert_runtime_interior_contract()
	quit(1 if failed else 0)

func _assert_descriptor_and_worker_contract() -> void:
	var generator := GENERATOR.new(SEED)
	var megastructure := MEGASTRUCTURE_GENERATOR.new(SEED).generate(Vector3i.ZERO)
	var approach: Array = (megastructure.get("entry", {}) as Dictionary).get("approach_anchor", [])
	var chunk := Vector2i(floori(float(approach[0]) / GENERATOR.CHUNK_SIZE), floori(float(approach[2]) / GENERATOR.CHUNK_SIZE))
	var descriptor := generator.chunk_descriptor(chunk.x, chunk.y)
	var megastructure_chunk: Dictionary = descriptor.get("megastructure", {})
	var intersections: Array = megastructure_chunk.get("intersections", [])
	_expect(GENERATOR.GENERATOR_SCHEMA_VERSION == "2.0.0" and str(megastructure_chunk.get("schema", "")) == "megastructure-chunk/v1" and not intersections.is_empty(), "v2 megastructure chunk descriptor missing")
	var interior: Dictionary = (intersections[0] as Dictionary).get("interior", {})
	_expect(str(interior.get("terrain_mode", "")) == "flat_enclosed_floor" and int(interior.get("floor_y", 0)) == 24 and not ((intersections[0] as Dictionary).get("macro", {}) as Dictionary).is_empty(), "megastructure interior intersection drifted")
	var scheduler := SCHEDULER.new(SEED)
	scheduler.request(chunk.x, chunk.y)
	var results := scheduler.wait_for_all()
	_expect(results.size() == 1 and (results[0].get("descriptor", {}) as Dictionary) == descriptor, "worker dropped megastructure chunk data")
	scheduler.shutdown()

func _assert_runtime_interior_contract() -> void:
	var main := (load(MAIN_SCENE_PATH) as PackedScene).instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("expedition")
	for _frame in range(45):
		await physics_frame
	var streamer = main.world_streamer
	var chunk: Vector2i = streamer.origin.chunk_at_local(main.player.global_position)
	var root_chunk := streamer.chunks.get("%d:%d" % [chunk.x, chunk.y]) as Node3D
	var terrain := root_chunk.get_node_or_null("Terrain") as StaticBody3D if root_chunk else null
	var visual := terrain.get_child(0) as MeshInstance3D if terrain and terrain.get_child_count() > 0 else null
	var mesh := visual.mesh as ArrayMesh if visual else null
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] if mesh else PackedVector3Array()
	var shell := root_chunk.get_node_or_null("MegastructureShell") as Node3D if root_chunk else null
	var collision := root_chunk.get_node_or_null("MegastructureCollision") as StaticBody3D if root_chunk else null
	var traversal := root_chunk.get_node_or_null("MegastructureTraversal") as Node3D if root_chunk else null
	var floor_is_flat := not vertices.is_empty()
	for vertex: Vector3 in vertices:
		floor_is_flat = floor_is_flat and is_equal_approx(vertex.y, 24.0)
	_expect(root_chunk != null and bool(root_chunk.get_meta("megastructure_interior", false)) and terrain != null and shell != null and collision != null and traversal != null and floor_is_flat, "streamed chunk did not attach the megastructure interior phases")
	var guide := traversal.get_node_or_null("TraversalGuide") as MeshInstance3D if traversal else null
	_expect(guide != null and shell.get_child_count() > 0 and collision.get_child_count() > 0 and is_equal_approx(streamer.ground_height(main.player.global_position), 24.0) and main.player.is_on_floor(), "runtime opening is not grounded inside the megastructure")
	var history_reveal: Dictionary = (main.megastructure_descriptor.get("reveals", []) as Array)[1]
	var history_anchor: Array = history_reveal.get("recommended_view_anchor", [])
	main.player.movement_enabled = false
	main.player.global_position = Vector3(float(history_anchor[0]), 25.55, float(history_anchor[2])) - Vector3(float(streamer.origin.origin_chunk.x) * 64.0, 0.0, float(streamer.origin.origin_chunk.y) * 64.0)
	for _frame in range(120):
		await physics_frame
	var history_chunk: Vector2i = streamer.origin.chunk_at_local(main.player.global_position)
	var history_root := streamer.chunks.get("%d:%d" % [history_chunk.x, history_chunk.y]) as Node3D
	var history := history_root.get_node_or_null("MegastructureTraversal/MegastructureHistory") as Node3D if history_root else null
	_expect(history != null and history.get_child_count() >= 5, "runtime history-view chunk did not render multiple epochs")
	main.queue_free()
	await process_frame

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
