extends SceneTree

const MAIN_SCENE_PATH := "res://scenes/main.tscn"

var failed := false

func _initialize() -> void:
	var main := (load(MAIN_SCENE_PATH) as PackedScene).instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("expedition")
	await process_frame
	var streamer = main.world_streamer
	var prototype := main.megastructure_prototype as Node3D
	var entry: Dictionary = main.megastructure_descriptor.get("entry", {})
	var approach: Array = entry.get("approach_anchor", [])
	var canonical: Vector3 = streamer.origin.world_position(main.player.global_position)
	_expect(prototype != null and is_equal_approx(canonical.x, float(approach[0])) and is_equal_approx(canonical.z, float(approach[2])), "entry prototype did not place the player at the canonical approach")
	var prior_origin: Vector2i = streamer.origin.origin_chunk
	var prior_position := prototype.global_position
	var target_chunk := Vector2i(prior_origin.x + streamer.origin.threshold_chunks, prior_origin.y)
	main.player.movement_enabled = false
	main.player.global_position = Vector3(float(target_chunk.x - prior_origin.x) * 64.0 + 32.0, main.player.global_position.y, 0.0)
	streamer.refresh(true)
	_expect(streamer.origin.origin_chunk == target_chunk, "entry prototype rebase fixture did not rebase")
	_expect(prototype.global_position == prior_position + Vector3(float(prior_origin.x - target_chunk.x) * 64.0, 0.0, 0.0), "entry prototype did not follow the origin rebase")
	main.queue_free()
	await process_frame
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
