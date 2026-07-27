extends SceneTree

func _initialize() -> void:
	var scene := load("res://scenes/main.tscn") as PackedScene
	var main := scene.instantiate()
	var runs: Variant = root.get_node_or_null("RunData")
	var app_settings: Variant = root.get_node_or_null("Settings")
	assert(runs != null, "RunData autoload missing")
	assert(app_settings != null, "Settings autoload missing")
	root.add_child(main)
	await process_frame
	assert(main.hud.theme != null, "ui theme missing")
	assert(main.hud.theme.default_font is FontFile, "BigBlueTerm font missing")
	assert(main.hud.theme.default_font.antialiasing == TextServer.FONT_ANTIALIASING_NONE, "pixel font antialiasing enabled")
	assert(main.display_filter_layer.layer < main.ui.layer, "pixel filter overlays the ui")
	var original_filter_mode := int(app_settings.get("pixel_filter_mode"))
	app_settings.call("set_pixel_filter_mode", 0)
	assert(not main.display_filter.visible, "pixel filter remained visible when disabled")
	app_settings.call("set_pixel_filter_mode", 2)
	assert(main.display_filter.visible, "2x pixel filter did not enable")
	var pixel_material := main.display_filter.material as ShaderMaterial
	assert(is_equal_approx(float(pixel_material.get_shader_parameter("pixel_size")), 2.0), "2x pixel filter size missing")
	app_settings.call("set_pixel_filter_mode", 4)
	assert(is_equal_approx(float(pixel_material.get_shader_parameter("pixel_size")), 4.0), "4x pixel filter size missing")
	app_settings.call("set_pixel_filter_mode", original_filter_mode)
	for level in LevelLibrary.all_levels():
		main.start_level(level.id)
		await process_frame
		assert(main.player != null, "missing player for " + level.id)
		assert(main.course != null, "missing course for " + level.id)
		assert(main.course.get_node_or_null("OpenBasin") != null, "missing open basin for " + level.id)
		assert(main.course.get_node_or_null("Summit") != null, "missing summit for " + level.id)
		assert(main.traversal_ramp_count >= 12, "missing traversal routes for " + level.id)
		assert(main.climbable_trunk_count >= 7, "missing climbable traversal for " + level.id)
		assert(main._collectible_count(level) >= 8, "missing collectibles for " + level.id)
		runs.advance(1.0)
		var before_pause: float = runs.elapsed
		main.show_pause()
		main._process(1.0)
		assert(is_equal_approx(float(runs.elapsed), before_pause), "timer advanced while paused for " + level.id)
		main.resume_run()
		main._restart_level()
		assert(is_zero_approx(float(runs.elapsed)), "reset did not clear timer for " + level.id)
	var wall_jump_player = main.player
	wall_jump_player.wall_jump_normal = Vector3(1.0, 0.0, 0.0)
	wall_jump_player.wall_jump_timer = 0.14
	wall_jump_player._wall_jump()
	assert(is_equal_approx(wall_jump_player.velocity.y, 8.4), "wall jump vertical force missing")
	assert(is_equal_approx(wall_jump_player.velocity.x, 13.0), "wall jump horizontal force missing")
	assert(wall_jump_player.can_dash, "wall jump did not refresh dash")
	wall_jump_player.can_double_jump = true
	wall_jump_player._double_jump()
	assert(is_equal_approx(wall_jump_player.velocity.y, 7.0), "double jump vertical force missing")
	assert(not wall_jump_player.can_double_jump, "double jump was not consumed")
	wall_jump_player.velocity.y = 4.0
	wall_jump_player._ground_slam()
	assert(is_equal_approx(wall_jump_player.velocity.y, -38.0), "ground slam did not cancel vertical momentum")
	assert(wall_jump_player.is_slamming, "ground slam state missing")
	main.queue_free()
	await process_frame
	quit()
