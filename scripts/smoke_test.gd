extends SceneTree

const LEVEL_BUILDER := preload("res://scripts/level_builder.gd")

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
	assert(main.display_filter_layer.layer < main.ui.layer, "pixel filter overlays ui")
	assert(main.style_fx_layer.layer > main.display_filter_layer.layer and main.style_fx_layer.layer < main.ui.layer, "style flash layer order incorrect")
	assert(main.style_award_feed is StyleAwardFeed, "style award feed missing")
	assert(InputMap.has_action("grapple"), "grapple input missing")
	assert(InputMap.has_action("glide"), "glide input missing")
	assert(InputMap.has_action("sprint"), "sprint input missing")
	var original_filter_mode := int(app_settings.get("pixel_filter_mode"))
	app_settings.call("set_pixel_filter_mode", 0)
	assert(not main.display_filter.visible, "pixel filter remained visible when disabled")
	app_settings.call("set_pixel_filter_mode", 4)
	assert(main.display_filter.visible, "4x pixel filter did not enable")
	app_settings.call("set_pixel_filter_mode", original_filter_mode)

	var levels := LevelLibrary.all_levels()
	assert(levels.size() == 1, "sandbox must be the only playable level")
	assert(str(levels[0].id) == "sandbox", "sandbox id missing")
	main.start_level("sandbox")
	await process_frame
	assert(main.player != null, "sandbox player missing")
	assert(main.course != null, "sandbox course missing")
	assert(str(main.course.get_meta("layout_id", "")) == "sandbox", "wrong sandbox layout id")
	assert(main.course.get_node_or_null("OpenBasin") != null, "sandbox recovery floor missing")
	assert(bool(main.course.get_node("OpenBasin").get_meta("recovery_floor", false)), "recovery floor metadata missing")
	for route_name in ["CentralPlaza", "MovementPlaza", "GapYard", "WallTower", "AerialAtrium", "PowerHall", "StyleBowl", "IntegratedLine"]:
		assert(main.course.get_node_or_null(route_name) != null, "sandbox route missing: " + route_name)
	assert(main.sandbox_stations.size() == 8, "sandbox station registry missing")
	assert(main.traversal_ramp_count >= 20, "sandbox traversal routes missing")
	assert(main.climbable_trunk_count >= 4, "sandbox wall-jump fixtures missing")
	assert(main.grapple_anchor_count >= 4, "sandbox grapple fixtures missing")
	assert(main.combo_gap_count >= 12, "sandbox style gaps missing")
	assert(main.recharge_gate_count >= 6, "sandbox recharge gates missing")
	assert(main._collectible_count(levels[0]) >= 18, "sandbox collectibles missing")
	assert(main.course.find_children("InteriorBuilding", "", true, false).size() >= 2, "interior buildings missing")
	assert(main.course.find_children("CentralResetPad", "", true, false).size() == 1, "central reset pad missing")
	assert(main.course.find_children("StationResetPad", "", true, false).size() >= 6, "station reset pads missing")
	var fixture_types: Dictionary = {}
	for node in main.course.find_children("*", "", true, false):
		if node is CourseTrigger:
			fixture_types[node.trigger_type] = true
	for trigger_type in [CourseTrigger.TriggerType.COLLECTIBLE, CourseTrigger.TriggerType.BOOST, CourseTrigger.TriggerType.LAUNCH, CourseTrigger.TriggerType.COMBO_GAP, CourseTrigger.TriggerType.RESET, CourseTrigger.TriggerType.RECHARGE]:
		assert(fixture_types.has(trigger_type), "sandbox fixture missing trigger type " + str(trigger_type))

	runs.advance(1.0)
	var session_time: float = runs.elapsed
	main._reset_to_station({"spawn": Vector3(20.0, 1.4, -72.0), "station": "Power Hall"})
	assert(main.player.global_position.is_equal_approx(Vector3(20.0, 1.4, -72.0)), "local reset spawn missing")
	assert(is_equal_approx(float(runs.elapsed), session_time), "local reset cleared free-play session")
	main._restart_level()
	assert(is_zero_approx(float(runs.elapsed)), "central reset did not restart session")
	await process_frame
	main.player.global_position = Vector3(30.0, 3.0, -47.0)
	main._refresh_sandbox_context()
	assert(main.current_station == "WALL TOWER", "station context did not update")

	var f3 := InputEventKey.new()
	f3.pressed = true
	f3.physical_keycode = KEY_F3
	main._input(f3)
	main._refresh_debug_hud()
	assert(main.debug_visible and main.debug_panel.visible, "F3 did not show diagnostics")
	assert("FPS" in main.debug_label.text and "PHYS ACTIVE" in main.debug_label.text and "TRIGGERS" in main.debug_label.text and "REFILLS" in main.debug_label.text, "diagnostics incomplete")
	main._input(f3)
	assert(not main.debug_visible and not main.debug_panel.visible, "F3 did not hide diagnostics")
	main.show_pause()
	assert(main.menu.find_child("QuitGame", true, false) is Button, "pause menu quit button missing")
	main.resume_run()

	var combo := StyleRun.new()
	combo.begin()
	combo.add_action("dash", 0.0)
	combo.add_action("dash", 0.1)
	assert(combo.active_score() == 528, "repeat decay or combo multiplier missing")
	combo.add_action("gap", 0.2, 300, "smoke-gap")
	var gap_score := combo.active_score()
	var duplicate_gap := combo.add_action("gap", 0.3, 300, "smoke-gap")
	assert(combo.active_score() == gap_score, "a gap scored twice in one combo")
	assert(not bool(duplicate_gap.get("awarded", true)), "duplicate gap emitted an award")
	combo.land(0.4)
	combo.tick(1.7)
	assert(combo.banked_score == gap_score, "link window did not bank grounded combo")
	combo.add_action("grapple", 1.8)
	var preserved_score := combo.banked_score
	combo.bail()
	assert(combo.banked_score == preserved_score and combo.active_score() == 0, "bail did not preserve banked style")
	var decay_combo := StyleRun.new()
	decay_combo.begin()
	decay_combo.add_action("gap", 0.0, 5000, "decay-gap")
	decay_combo.tick(1.2)
	var banked_style := decay_combo.banked_score
	decay_combo.tick(3.0)
	var early_decay := decay_combo.last_decay
	assert(decay_combo.banked_score < banked_style and early_decay > 0, "idle style did not decay")
	decay_combo.tick(5.0)
	assert(decay_combo.last_decay > early_decay, "style decay did not accelerate with idle time")
	decay_combo.add_action("dash", 5.0)
	assert(decay_combo.last_decay == 0, "new combo did not stop style decay")
	var transition_combo := StyleRun.new()
	transition_combo.begin()
	transition_combo.add_action("slide", 0.0)
	var slide_jump_result := transition_combo.add_action("slide_jump", 0.1)
	assert(str(slide_jump_result.award.get("transition", "")) == "SLIDE HOP", "slide jump transition style missing")
	assert(int(slide_jump_result.award.get("transition_points", 0)) > 0, "transition bonus missing")

	var sandbox_player: Variant = main.player
	var original_tether_toggle := bool(app_settings.get("tether_toggle"))
	app_settings.set("tether_toggle", false)
	assert(not sandbox_player._tether_toggle_enabled(), "hold tether setting missing")
	app_settings.set("tether_toggle", true)
	assert(sandbox_player._tether_toggle_enabled(), "toggle tether setting missing")
	app_settings.set("tether_toggle", original_tether_toggle)
	sandbox_player.velocity = Vector3(0.0, 0.0, -24.0)
	sandbox_player._apply_horizontal_movement(Vector2.ZERO, false, 0.1)
	assert(sandbox_player.velocity.z < -23.0, "air movement bled momentum without input")
	sandbox_player._apply_horizontal_movement(Vector2(1.0, 0.0), false, 0.1)
	assert(sandbox_player.velocity.x > 0.0 and sandbox_player.velocity.z < -20.0, "air strafe did not preserve forward momentum")
	sandbox_player.velocity = Vector3(0.0, 0.0, -18.0)
	sandbox_player.is_sliding = true
	sandbox_player._slide_latched = true
	sandbox_player._slide_jump()
	assert(is_equal_approx(sandbox_player.velocity.y, SpeedPlayer.JUMP_VELOCITY), "slide jump vertical force missing")
	assert(sandbox_player.velocity.z < -18.0, "slide jump did not preserve momentum")
	sandbox_player.last_wall_run_collider_id = 0
	sandbox_player.wall_jump_collider_id = 84
	sandbox_player.wall_jump_normal = Vector3(1.0, 0.0, 0.0)
	sandbox_player.wall_run_timer = 0.0
	sandbox_player.velocity = Vector3(0.0, 0.0, -14.0)
	Input.action_press("move_forward")
	sandbox_player._update_wall_run(false)
	assert(sandbox_player.is_wall_running, "speed-gated wall run did not activate")
	Input.action_release("move_forward")
	sandbox_player.is_wall_running = false
	sandbox_player.velocity = Vector3(0.0, 0.0, -20.0)
	sandbox_player.apply_boost(Vector3(0.0, 0.0, -1.0))
	assert(sandbox_player.velocity.z < -20.0, "boost overwrote instead of adding momentum")
	sandbox_player.velocity = Vector3.ZERO
	sandbox_player.ramp_launch_cooldown = 0.0
	sandbox_player.velocity.z = -18.0
	sandbox_player._try_ramp_launch(Vector3(0.0, 0.82, 0.57).normalized())
	assert(sandbox_player.velocity.y > 0.0, "ramp launch did not convert speed into height")
	sandbox_player.velocity = Vector3(8.0, 0.0, -14.0)
	Input.action_press("move_forward")
	sandbox_player._dash()
	assert(sandbox_player.velocity.x > 7.0 and sandbox_player.velocity.z < -14.0, "directional dash did not preserve lateral momentum")
	Input.action_release("move_forward")
	sandbox_player.is_gliding = true
	sandbox_player.camera.rotation.x = -0.7
	sandbox_player.velocity = Vector3(0.0, -2.0, -15.0)
	sandbox_player._apply_glide_swoop(0.2)
	assert(sandbox_player.velocity.z < -15.0, "glide dive did not convert descent into speed")
	sandbox_player.is_gliding = false
	sandbox_player.is_slamming = true
	sandbox_player.velocity = Vector3(0.0, -20.0, -12.0)
	sandbox_player._slam_bounce()
	assert(is_equal_approx(sandbox_player.velocity.y, SpeedPlayer.SLAM_BOUNCE_VELOCITY), "slam rebound missing")
	assert(sandbox_player.can_dash and sandbox_player.can_double_jump, "slam rebound did not restore air tools")
	sandbox_player.roll_window = 0.1
	sandbox_player.velocity = Vector3(0.0, -12.0, -10.0)
	assert(sandbox_player._try_perfect_land(-12.0), "perfect landing window missing")
	assert(sandbox_player.is_sliding and sandbox_player.velocity.z < -10.0, "perfect landing did not carry into slide")
	sandbox_player.can_dash = false
	main._on_trigger(CourseTrigger.TriggerType.RECHARGE, {"tool": "dash"})
	assert(sandbox_player.can_dash, "recharge gate did not restore dash")
	sandbox_player.is_sliding = false
	sandbox_player.velocity = Vector3(0.0, 0.0, -10.0)
	Input.action_press("sprint")
	sandbox_player._handle_sprint(true)
	assert(sandbox_player.is_sprinting, "ground sprint did not activate")
	assert(is_equal_approx(sandbox_player._movement_top_speed(true), 17.0), "sprint speed missing")
	sandbox_player.velocity = Vector3(0.0, 0.0, -19.0)
	assert(is_equal_approx(sandbox_player._movement_top_speed(true), 19.0), "slide momentum did not carry into sprint")
	assert(sandbox_player._sprint_dash_requested(false), "sprint did not request air dash")
	Input.action_release("sprint")
	sandbox_player.wall_jump_normal = Vector3(1.0, 0.0, 0.0)
	sandbox_player.wall_jump_collider_id = 42
	sandbox_player.last_wall_jump_collider_id = 0
	sandbox_player.wall_jump_timer = 0.14
	sandbox_player.velocity = Vector3(0.0, 0.0, 16.0)
	sandbox_player._wall_jump()
	assert(is_equal_approx(sandbox_player.velocity.y, 8.4), "wall jump vertical force missing")
	assert(is_equal_approx(sandbox_player.velocity.x, 4.5), "wall jump separation force missing")
	sandbox_player.velocity = Vector3.ZERO
	sandbox_player._wall_jump()
	assert(sandbox_player.velocity == Vector3.ZERO, "same wall allowed a repeat wall jump")
	sandbox_player.wall_jump_collider_id = 43
	sandbox_player._wall_jump()
	assert(is_equal_approx(sandbox_player.velocity.y, 8.4), "different wall did not restore wall jump")
	sandbox_player.is_slamming = false
	sandbox_player.is_gliding = false
	sandbox_player.is_grappling = false
	sandbox_player.velocity.y = -20.0
	sandbox_player._set_wall_slide(true, false)
	assert(sandbox_player.is_wall_sliding, "wall slide did not activate")
	assert(is_equal_approx(sandbox_player.velocity.y, -SpeedPlayer.WALL_SLIDE_FALL_SPEED), "wall slide speed cap missing")
	sandbox_player._set_wall_slide(false, false)
	assert(not sandbox_player.is_wall_sliding, "wall slide did not clear after leaving wall")
	sandbox_player.can_double_jump = true
	sandbox_player._double_jump()
	assert(is_equal_approx(sandbox_player.velocity.y, 7.0), "double jump vertical force missing")
	assert(not sandbox_player.can_double_jump, "double jump was not consumed")
	sandbox_player.velocity.y = 4.0
	sandbox_player._ground_slam()
	assert(is_equal_approx(sandbox_player.velocity.y, -38.0), "ground slam did not cancel vertical momentum")
	assert(sandbox_player.is_slamming, "ground slam state missing")
	sandbox_player.reset_for_bail(Vector3(0.0, 0.9, 3.0))
	var grapple_anchor := Node3D.new()
	grapple_anchor.add_to_group("grapple_anchor")
	main.course.add_child(grapple_anchor)
	grapple_anchor.global_position = sandbox_player.global_position + Vector3(0.0, 3.0, -8.0)
	sandbox_player.velocity = Vector3.ZERO
	assert(sandbox_player._try_grapple(), "grapple did not acquire visible anchor")
	sandbox_player.grapple_anchor = grapple_anchor
	sandbox_player.grapple_target = grapple_anchor.global_position
	sandbox_player.grapple_rope_length = 7.0
	var rope_length: float = float(sandbox_player.grapple_rope_length)
	var tether_direction: Vector3 = (grapple_anchor.global_position - (sandbox_player.global_position + Vector3(0.0, 1.1, 0.0))).normalized()
	sandbox_player._update_grapple(0.1)
	assert(sandbox_player.is_grappling, "grapple state missing")
	assert(sandbox_player.velocity.dot(tether_direction) > 0.0, "grapple did not pull toward anchor")
	var pump_direction: Vector3 = sandbox_player._input_direction(Vector2(1.0, 0.0)).slide(tether_direction).normalized()
	assert(pump_direction.length() > 0.1, "tether pump direction missing")
	var tangential_speed: float = sandbox_player.velocity.dot(pump_direction)
	sandbox_player._update_grapple(0.1, Vector2(1.0, 0.0))
	assert(sandbox_player.grapple_rope_length < rope_length and sandbox_player.velocity.dot(pump_direction) > tangential_speed, "tether did not reel and pump tangential momentum")
	sandbox_player._stop_grapple()
	sandbox_player.velocity = Vector3(0.0, 0.0, -5.0)
	main._refresh_grapple_reticle()
	await process_frame
	assert(main.grapple_reticle.visible, "grapple reticle did not appear while moving")
	sandbox_player.velocity = Vector3.ZERO
	sandbox_player.is_slamming = false
	sandbox_player.velocity.y = -8.0
	Input.action_press("glide")
	sandbox_player._update_glide_state(false)
	assert(sandbox_player.is_gliding, "glide did not activate while falling")
	Input.action_release("glide")
	sandbox_player._update_glide_state(false)
	assert(not sandbox_player.is_gliding, "glide did not release")
	var level_document_script := load("res://scripts/level_document.gd")
	var level_document: Variant = level_document_script.create_blank("smoke-creative-" + str(OS.get_process_id()) + "-" + str(Time.get_ticks_msec()), "Smoke Creative")
	var module_result: Dictionary = level_document.apply_transaction({"action": "add_module", "module": {"id": "smoke-platform", "kind": "platform", "position": [0.0, 0.0, 0.0], "size": [6.0, 0.8, 6.0]}})
	assert(bool(module_result.get("ok", false)), "creative module transaction failed")
	assert(level_document.validation_report().get("errors", []).is_empty(), "creative document validation failed")
	assert(bool(level_document.undo().get("ok", false)), "creative undo failed")
	assert(bool(level_document.redo().get("ok", false)), "creative redo failed")
	var authored_document: Variant = level_document_script.load_from_path("res://levels/sandbox.level.json")
	assert(authored_document.validation_report().get("errors", []).is_empty(), "sandbox level document validation failed")
	main.creative_document = authored_document
	main._open_creative_mode()
	await process_frame
	assert(main.creative_editor.is_open(), "creative editor did not open")
	var built_module := false
	for node in main.creative_geometry_root.find_children("*", "Node3D", true, false):
		if str(node.get_meta("level_module_id", "")) == "aerial-anchor":
			built_module = true
	assert(built_module, "creative builder did not instantiate module")
	main._playtest_creative_draft()
	assert(main.player.movement_enabled and runs.running, "creative playtest did not start")
	main._return_to_creative_editor()
	assert(main.creative_editor.is_open() and not runs.running, "creative editor did not resume after playtest")
	var fixture_file := FileAccess.open("res://levels/validation-fixtures.v1.json", FileAccess.READ)
	var fixtures: Dictionary = JSON.parse_string(fixture_file.get_as_text())
	for fixture in fixtures.get("cases", []):
		var fixture_document: Variant = level_document_script.from_data(fixture.get("document", {}))
		var fixture_report: Dictionary = fixture_document.validation_report()
		assert(fixture_report.get("error_codes", []) == fixture.get("error_codes", []), "shared validation error fixture drift: " + str(fixture.get("id", "")))
		assert(fixture_report.get("warning_codes", []) == fixture.get("warning_codes", []), "shared validation warning fixture drift: " + str(fixture.get("id", "")))
	var smoke_id := str(OS.get_process_id()) + "-" + str(Time.get_ticks_msec())
	var durable_document: Variant = level_document_script.create_blank("smoke-durable-" + smoke_id, "Smoke Durable")
	var durable_first: Dictionary = durable_document.apply_transaction({"action": "add_module", "expected_revision": 0, "module": {"id": "durable-reset", "kind": "reset", "position": [0.0, 0.0, 0.0], "spawn": [0.0, 1.0, 0.0]}})
	assert(bool(durable_first.get("ok", false)) and int(durable_first.get("revision", -1)) == 1, "durable revision commit failed")
	var stale: Dictionary = durable_document.apply_transaction({"action": "add_module", "expected_revision": 0, "module": {"id": "stale", "kind": "platform", "position": [2.0, 0.0, 0.0]}})
	assert(bool(stale.get("conflict", false)), "stale creative edit was not rejected")
	assert(not durable_document.revision_diff(1).is_empty(), "durable revision diff missing")
	var rolled_back: Dictionary = durable_document.rollback_to_revision(0, 1)
	assert(bool(rolled_back.get("ok", false)) and int(rolled_back.get("revision", -1)) == 2, "durable rollback did not create a new revision")
	var checkpoint_document: Variant = level_document_script.create_blank("smoke-checkpoint-" + smoke_id, "Smoke Checkpoint")
	checkpoint_document.apply_transaction({"action": "add_module", "expected_revision": 0, "module": {"id": "checkpoint", "kind": "checkpoint", "position": [0.0, 1.0, -3.0]}})
	var checkpoint_target := Node3D.new()
	main.add_child(checkpoint_target)
	var checkpoint_index: Dictionary = LEVEL_BUILDER.build_index(main, checkpoint_document, checkpoint_target)
	assert(checkpoint_index.get("modules", {}).has("checkpoint"), "checkpoint module did not build")
	var checkpoint_report: Dictionary = checkpoint_document.save_playtest_report({"elapsed": 2.0, "max_speed": 15.0, "checkpoints": ["checkpoint"], "events": [], "path": []})
	assert(bool(checkpoint_report.get("ok", false)), "playtest report did not persist")
	var approved: Dictionary = checkpoint_document.approve_with_evidence(checkpoint_report.get("report", {}))
	assert(bool(approved.get("ok", false)) and str(checkpoint_document.data.get("status", "")) == "approved", "manual evidence approval failed")
	var incremental_document: Variant = level_document_script.create_blank("smoke-incremental-" + smoke_id, "Smoke Incremental")
	var incremental_target := Node3D.new()
	main.add_child(incremental_target)
	var incremental_index: Dictionary = LEVEL_BUILDER.build_index(main, incremental_document, incremental_target)
	var incremental_add: Dictionary = incremental_document.apply_transaction({"action": "add_module", "expected_revision": 0, "module": {"id": "incremental-platform", "kind": "platform", "position": [3.0, 0.0, 0.0], "size": [3.0, 0.8, 3.0]}})
	incremental_index = LEVEL_BUILDER.apply_changes(main, incremental_document, incremental_target, incremental_index, incremental_add.get("changed_module_ids", []))
	assert(incremental_index.get("modules", {}).has("incremental-platform"), "incremental module update failed")

	main.queue_free()
	await process_frame
	quit()
