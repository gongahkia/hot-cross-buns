extends SceneTree

func _initialize() -> void:
	var scene := load("res://scenes/main.tscn") as PackedScene
	var main := scene.instantiate()
	var runs: Variant = root.get_node_or_null("RunData")
	assert(runs != null, "RunData autoload missing")
	root.add_child(main)
	await process_frame
	for level in LevelLibrary.all_levels():
		main.start_level(level.id)
		await process_frame
		assert(main.player != null, "missing player for " + level.id)
		assert(main.course != null, "missing course for " + level.id)
		assert(main._collectible_count(level) > 0, "missing collectibles for " + level.id)
		runs.advance(1.0)
		var before_pause: float = runs.elapsed
		main.show_pause()
		main._process(1.0)
		assert(is_equal_approx(float(runs.elapsed), before_pause), "timer advanced while paused for " + level.id)
		main.resume_run()
		main._restart_level()
		assert(is_zero_approx(float(runs.elapsed)), "reset did not clear timer for " + level.id)
	main.queue_free()
	await process_frame
	quit()
