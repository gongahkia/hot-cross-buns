extends Node3D

const LEVELS := preload("res://scripts/level_library.gd")
const GRAPPLE_RETICLE := preload("res://scripts/grapple_reticle.gd")
const STYLE_AWARD_FEED := preload("res://scripts/style_award_feed.gd")
const SANDBOX_GEOMETRY_EXPORTER := preload("res://scripts/generate_sandbox_geometry.gd")
const LEVEL_DOCUMENT := preload("res://scripts/level_document.gd")
const LEVEL_BUILDER := preload("res://scripts/level_builder.gd")
const CREATIVE_EDITOR := preload("res://scripts/creative_editor.gd")
const WORLD_STREAMER := preload("res://scripts/world_streamer.gd")
const WORLD_DIAGNOSTICS := preload("res://scripts/world_diagnostics.gd")
const STREAMING_PROFILE := preload("res://scripts/streaming_profile_recorder.gd")
const PHOTO_MODE := preload("res://scripts/photo_mode.gd")
const WORLD_WEATHER := preload("res://scripts/world_weather.gd")
const WORLD_ATMOSPHERE := preload("res://scripts/world_atmosphere.gd")
const PIXEL_PRESENTATION := preload("res://scripts/pixel_presentation.gd")
const WEATHER_LAYERS := preload("res://scripts/weather_layers.gd")
const SURVIVAL_MOVEMENT_POLICY := preload("res://scripts/survival_movement_policy.gd")
const SURVIVAL_MOVEMENT_FEEDBACK := preload("res://scripts/survival_movement_feedback.gd")
const SURVIVAL_TRAVERSAL_TELEMETRY := preload("res://scripts/survival_traversal_telemetry.gd")
const TRAVERSAL_MELEE := preload("res://scripts/traversal_melee.gd")
const SLIDE_IMPACT := preload("res://scripts/slide_impact.gd")
const SLAM_IMPACT := preload("res://scripts/slam_impact.gd")
const GRAPPLE_IMPACT := preload("res://scripts/grapple_impact.gd")
const WILDLIFE_FEEDBACK := preload("res://scripts/wildlife_feedback.gd")
const TRAVERSAL_MATERIAL_PLACEMENT := preload("res://scripts/traversal_material_placement.gd")
const RUN_ARCHIVE := preload("res://scripts/run_archive.gd")
const RUN_EXPORT := preload("res://scripts/run_export.gd")
const WORLD_SURVEY_JOURNAL := preload("res://scripts/world_survey_journal.gd")
const SHELTER_COST := {"wood": 3, "scrap": 1, "fiber": 2}
const PLATFORM_COST := {"wood": 2, "scrap": 2, "fiber": 1}
const SANDBOX_GEOMETRY_PATH := "res://scenes/sandbox_geometry.tscn"
const SANDBOX_GEOMETRY := preload("res://scenes/sandbox_geometry.tscn")
const SANDBOX_STATION_CENTERS := {
	"CENTRAL PLAZA": Vector3(0.0, 0.5, 1.0),
	"MOVEMENT PLAZA": Vector3(0.0, 1.5, -24.0),
	"GAP YARD": Vector3(-31.0, 2.5, -47.0),
	"WALL TOWER": Vector3(30.0, 3.0, -47.0),
	"AERIAL ATRIUM": Vector3(-30.0, 5.0, -86.0),
	"POWER HALL": Vector3(29.0, 3.0, -87.0),
	"STYLE BOWL": Vector3(0.0, 2.0, -119.0),
	"INTEGRATED LINE": Vector3(2.0, 7.0, -81.0),
}

var course: Node3D
var player: SpeedPlayer
var player_spawn := Vector3.ZERO
var current_level: Dictionary = {}
var collected_in_level := 0
var total_collectibles_in_level := 0
var traversal_ramp_count := 0
var climbable_trunk_count := 0
var grapple_anchor_count := 0
var combo_gap_count := 0
var recharge_gate_count := 0
var trigger_count := 0
var sandbox_stations: Array[Dictionary] = []
var current_station := "Central Plaza"
var last_sandbox_event := "Session started"
var frame_time := 0.0
var world_streamer
var photo_mode
var current_region: Dictionary = {}
var weather_clock := 0.0
var weather_forecast: Array = []
var weather_forecast_key := ""
var last_resolved_run: Dictionary = {}
var run_archive = RUN_ARCHIVE.new()
var world_journal = WORLD_SURVEY_JOURNAL.new()
var survey_check_time := 0.0
var streaming_profile = STREAMING_PROFILE.new()
var streaming_profile_sample_time := 0.0
var survival_movement: Dictionary = {}
var run_balance_telemetry = SURVIVAL_TRAVERSAL_TELEMETRY.new()
var expedition_environment: Environment
var expedition_sun: DirectionalLight3D
var weather_particles: GPUParticles3D

var ui: CanvasLayer
var hud: Control
var menu: Control
var display_filter: ColorRect
var display_filter_layer: CanvasLayer
var style_fx_layer: CanvasLayer
var style_flash: ColorRect
var style_flash_tween: Tween
var timer_label: Label
var collect_label: Label
var style_score_label: Label
var combo_label: Label
var style_event_label: Label
var forecast_label: Label
var style_meter: ProgressBar
var style_meter_fill: StyleBoxFlat
var style_award_feed: StyleAwardFeed
var style_meter_tween: Tween
var briefing_label: Label
var grapple_reticle: GrappleReticle
var debug_panel: PanelContainer
var debug_label: Label
var debug_visible := false
var rebinding_action := ""
var rebinding_button: Button
var menu_mode := "title"
var foliage_shader: Shader
var pulse_shader: Shader
var ui_theme: Theme
var geometry_export_mode := false
var creative_editor: Variant
var creative_document: Variant
var creative_geometry_root: Node3D
var creative_build_index: Dictionary = {}
var creative_session := false
var creative_playtest: Dictionary = {}
var creative_sample_timer := 0.0
var creative_ghost: MeshInstance3D
var creative_ghost_path: Array = []
var creative_ghost_elapsed := 0.0
var creative_heatmap_root: Node3D

func _ready() -> void:
	geometry_export_mode = OS.get_cmdline_user_args().has("--generate-sandbox-geometry")
	process_mode = Node.PROCESS_MODE_ALWAYS
	ui_theme = _make_ui_theme()
	foliage_shader = _make_foliage_shader()
	pulse_shader = _make_pulse_shader()
	_build_ui()
	creative_editor = CREATIVE_EDITOR.new()
	creative_editor.document_changed.connect(_rebuild_creative_geometry)
	creative_editor.playtest_requested.connect(_playtest_creative_draft)
	creative_editor.close_requested.connect(_exit_creative_mode)
	add_child(creative_editor)
	photo_mode = PHOTO_MODE.new()
	photo_mode.captured.connect(_on_photo_captured)
	add_child(photo_mode)
	Survival.depleted.connect(_on_survival_depleted)
	Settings.pixel_filter_mode_changed.connect(_apply_pixel_filter)
	show_title()
	if geometry_export_mode:
		call_deferred("_generate_sandbox_geometry")

func _generate_sandbox_geometry() -> void:
	start_level("sandbox")
	await get_tree().process_frame
	var generated_player := player
	player = null
	var save_error := SANDBOX_GEOMETRY_EXPORTER.export_course(course, generated_player, SANDBOX_GEOMETRY_PATH)
	if save_error != OK:
		push_error("Could not export sandbox geometry: " + error_string(save_error))
	get_tree().quit(0 if save_error == OK else 1)

func _build_ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 10
	ui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(ui)
	hud = Control.new()
	hud.theme = ui_theme
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud)
	timer_label = _label("00:00.000", 32, Color("#edf3d5"))
	collect_label = _label("PICKUPS 0/0", 16, Color("#f2d98c"))
	timer_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	collect_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	timer_label.position = Vector2(22.0, 20.0)
	timer_label.custom_minimum_size = Vector2(170.0, 42.0)
	collect_label.custom_minimum_size = Vector2(100.0, 28.0)
	hud.add_child(timer_label)
	var style_box := VBoxContainer.new()
	style_box.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	style_box.position = Vector2(22.0, -158.0)
	style_box.custom_minimum_size = Vector2(312.0, 148.0)
	style_box.add_theme_constant_override("separation", 2)
	hud.add_child(style_box)
	style_score_label = _label("STYLE 000000  QUIET", 21, Color("#f1d477"))
	combo_label = _label("COMBO --", 16, Color("#b9f6df"))
	style_event_label = _label("CHAIN MOVEMENT TO BANK STYLE", 13, Color("#9db197"))
	forecast_label = _label("FORECAST --", 13, Color("#9db197"))
	style_meter = ProgressBar.new()
	style_meter.show_percentage = false
	style_meter.min_value = 0.0
	style_meter.max_value = 100.0
	style_meter.custom_minimum_size = Vector2(310.0, 14.0)
	var meter_background := StyleBoxFlat.new()
	meter_background.bg_color = Color("#102018d9")
	meter_background.border_color = Color("#526f57")
	meter_background.set_border_width_all(1)
	style_meter_fill = StyleBoxFlat.new()
	style_meter_fill.bg_color = Color("#8ed6ae")
	style_meter_fill.set_corner_radius_all(2)
	style_meter.add_theme_stylebox_override("background", meter_background)
	style_meter.add_theme_stylebox_override("fill", style_meter_fill)
	style_box.add_child(collect_label)
	style_box.add_child(style_score_label)
	style_box.add_child(combo_label)
	style_box.add_child(style_meter)
	style_box.add_child(style_event_label)
	style_box.add_child(forecast_label)
	briefing_label = _label("", 22, Color("#e9f0d8"))
	briefing_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	briefing_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	briefing_label.position.y = 84.0
	briefing_label.size.x = 640.0
	briefing_label.position.x = -320.0
	hud.add_child(briefing_label)
	grapple_reticle = GRAPPLE_RETICLE.new()
	hud.add_child(grapple_reticle)
	style_award_feed = STYLE_AWARD_FEED.new()
	style_award_feed.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	style_award_feed.position = Vector2(-352.0, 94.0)
	hud.add_child(style_award_feed)
	debug_panel = PanelContainer.new()
	debug_panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	debug_panel.position = Vector2(-418.0, 20.0)
	debug_panel.custom_minimum_size = Vector2(396.0, 0.0)
	var debug_style := StyleBoxFlat.new()
	debug_style.bg_color = Color("#07100be8")
	debug_style.border_color = Color("#8ed6ae")
	debug_style.set_border_width_all(1)
	debug_style.content_margin_left = 12.0
	debug_style.content_margin_right = 12.0
	debug_style.content_margin_top = 10.0
	debug_style.content_margin_bottom = 10.0
	debug_panel.add_theme_stylebox_override("panel", debug_style)
	debug_label = _label("", 13, Color("#c7f5d4"))
	debug_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	debug_panel.add_child(debug_label)
	debug_panel.visible = false
	hud.add_child(debug_panel)
	hud.visible = false
	menu = Control.new()
	menu.theme = ui_theme
	menu.process_mode = Node.PROCESS_MODE_ALWAYS
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	menu.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui.add_child(menu)
	display_filter_layer = CanvasLayer.new()
	display_filter_layer.layer = 5
	display_filter_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(display_filter_layer)
	display_filter = ColorRect.new()
	display_filter.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	display_filter.mouse_filter = Control.MOUSE_FILTER_IGNORE
	display_filter.material = _make_pixel_filter_material()
	display_filter_layer.add_child(display_filter)
	style_fx_layer = CanvasLayer.new()
	style_fx_layer.layer = 6
	style_fx_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(style_fx_layer)
	style_flash = ColorRect.new()
	style_flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	style_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	style_flash.visible = false
	style_fx_layer.add_child(style_flash)
	_apply_pixel_filter(Settings.pixel_filter_mode)

func _process(delta: float) -> void:
	frame_time = delta
	_advance_playtest_ghost(delta)
	if not rebinding_action.is_empty():
		return
	if get_tree().paused:
		if Input.is_action_just_pressed("pause"):
			resume_run()
		return
	if RunData.running:
		if not photo_mode.active and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		RunData.set_style_movement_active(player != null and player.style_multiplier_active())
		_present_style_result(RunData.advance(delta))
		if not photo_mode.active and Input.is_action_just_pressed("consume_food"):
			Survival.consume_food()
		if bool(current_level.get("procedural", false)) and world_streamer and not photo_mode.active:
			var environment:Dictionary=world_streamer.sample_at(player.global_position)
			weather_clock += delta
			survey_check_time -= delta
			if survey_check_time <= 0.0:
				survey_check_time = 0.25
				var landmark: Dictionary = world_streamer.landmark_at(player.global_position)
				if world_journal.survey_landmark(landmark): last_sandbox_event = "SURVEYED " + str(landmark.get("name", landmark.get("kind", "LANDMARK"))).to_upper()
			environment["weather"] = WORLD_WEATHER.sample({"seed": world_streamer.generator.seed}, {"x": player.global_position.x, "y": player.global_position.z, "temperature": environment.temperature, "rainfall": environment.rainfall, "water": environment.water}, {"clock": weather_clock})
			_apply_expedition_atmosphere(environment.weather)
			if Input.is_action_just_pressed("collect_water"):Survival.collect_water_source(environment)
			if Input.is_action_just_pressed("purify_water"):Survival.purify_water()
			if Input.is_action_just_pressed("consume_water"):Survival.consume_water()
			if Input.is_action_just_pressed("place_material"):_attempt_material_placement()
			if Input.is_action_just_pressed("build_shelter"):_attempt_shelter_construction()
			if Input.is_action_just_pressed("build_platform"):_attempt_platform_construction()
			if Input.is_action_just_pressed("craft_filter"):_craft_field_filter()
			_attempt_wildlife_traversal_hits()
			environment["shelter"] = world_streamer.shelter_cover_at(player.global_position)
			survival_movement = SURVIVAL_MOVEMENT_POLICY.evaluate(Survival.snapshot(), player.survival_movement_state())
			player.set_survival_speed_multiplier(float(survival_movement.speed_multiplier))
			run_balance_telemetry.record(delta, Survival.snapshot(), survival_movement, RunData.style_snapshot())
			Survival.advance(delta, environment, player.survival_exertion_active())
		_refresh_hud()
		_refresh_grapple_reticle()
		_refresh_sandbox_context()
		_record_streaming_profile(delta)
		_refresh_debug_hud()
		_record_creative_sample(delta)
		if bool(current_level.get("procedural", false)) and Input.is_action_just_pressed("extract"):
			show_extraction_confirm()
			return
		if Input.is_action_just_pressed("pause"):
			show_pause()

func _input(event: InputEvent) -> void:
	if photo_mode and photo_mode.handle_input(event):
		get_viewport().set_input_as_handled()
		return
	if RunData.running and not get_tree().paused and event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F2 and rebinding_action.is_empty():
		if creative_session and not creative_editor.is_open():
			_return_to_creative_editor()
		else:
			_open_creative_mode()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F3 and rebinding_action.is_empty():
		debug_visible = not debug_visible
		debug_panel.visible = debug_visible and hud.visible
		if debug_visible:
			_refresh_debug_hud()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_L and rebinding_action.is_empty():
		_toggle_streaming_profile()
		get_viewport().set_input_as_handled()
		return
	if rebinding_action.is_empty():
		return
	if event is InputEventKey and event.pressed and not event.echo:
		Settings.set_binding(rebinding_action, event)
		_finish_rebind()
		get_viewport().set_input_as_handled()
	elif event is InputEventJoypadButton and event.pressed:
		Settings.set_binding(rebinding_action, event)
		_finish_rebind()
		get_viewport().set_input_as_handled()

func show_title() -> void:
	menu_mode = "title"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	get_tree().paused = false
	RunData.running = false
	if player:
		player.movement_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.visible = false
	_clear_style_flash()
	style_award_feed.clear_feed()
	grapple_reticle.clear_target()
	_clear_menu()
	var panel := _center_panel(Vector2(680.0, 520.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	box.add_child(_label("a-slow-walk", 46, Color("#edf3d5")))
	box.add_child(_label("infinite survival traversal", 18, Color("#9db197")))
	var divider := HSeparator.new()
	box.add_child(divider)
	box.add_child(_label("Stay alive, cross reclaimed Earth, and bank movement.", 18, Color("#d3dec5")))
	var start := _button("Choose a journey", 22)
	start.pressed.connect(show_level_select)
	box.add_child(start)
	var creative := _button("Creative mode", 22)
	creative.pressed.connect(_open_creative_mode)
	box.add_child(creative)
	var settings := _button("Settings", 18)
	settings.pressed.connect(show_settings.bind("title"))
	box.add_child(settings)
	var records := _button("Run records", 18)
	records.pressed.connect(show_run_archive)
	box.add_child(records)
	var journal := _button("Survey journal", 18)
	journal.pressed.connect(show_world_journal.bind("title"))
	box.add_child(journal)
	box.add_child(_label("WASD + Mouse/Arrows - Ctrl sprint/air dash - C slide - E tether - F glide - Q slam - Shift dash - R reset - F3 debug - L profile", 14, Color("#8ea18a")))

func show_run_archive() -> void:
	menu_mode = "records"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	_clear_menu()
	var panel := _center_panel(Vector2(680.0, 520.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	box.add_child(_label("Run records", 34, Color("#edf3d5")))
	var records: Array = run_archive.list()
	if records.is_empty():
		box.add_child(_label("No resolved expeditions.", 17, Color("#b5c6a5")))
	else:
		for record: Dictionary in records:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 10)
			var detail := _label("#%02d  %s  %s  %s  %d resources" % [int(record.id),str(record.outcome).to_upper(),_time_text(float(record.elapsed)),str(record.level).to_upper(),(record.resources as Dictionary).size()], 16, Color("#d3dec5"))
			detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(detail)
			var export := _button("Export", 14)
			export.pressed.connect(_export_run_card.bind(record))
			row.add_child(export)
			box.add_child(row)
	if RunData.running:
		var seed_export := _button("Export current seed", 16)
		seed_export.pressed.connect(_export_seed.bind(RunData.run_seed))
		box.add_child(seed_export)
	var back := _button("Back", 18)
	back.pressed.connect(show_title)
	box.add_child(back)

func show_world_journal(back_mode: String) -> void:
	menu_mode = "journal"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	_clear_menu()
	var panel := _center_panel(Vector2(680.0, 560.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	box.add_child(_label("Survey journal", 34, Color("#edf3d5")))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size.y = 390.0
	box.add_child(scroll)
	var entries := VBoxContainer.new()
	entries.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	entries.add_theme_constant_override("separation", 6)
	scroll.add_child(entries)
	var snapshot := world_journal.snapshot()
	var regions: Array = snapshot.regions
	var landmarks: Array = snapshot.landmarks
	if regions.is_empty() and landmarks.is_empty():
		entries.add_child(_label("No survey discoveries in this expedition.", 17, Color("#b5c6a5")))
	else:
		entries.add_child(_label("REGIONS  %d" % regions.size(), 18, Color("#9db197")))
		for region: Dictionary in regions:
			entries.add_child(_label("%s — %s" % [str(region.name), str(region.family).to_upper()], 16, Color("#d3dec5")))
		entries.add_child(_label("LANDMARKS  %d" % landmarks.size(), 18, Color("#9db197")))
		for landmark: Dictionary in landmarks:
			var taxonomy := str(landmark.get("taxonomy", ""))
			var detail := str(landmark.kind) if taxonomy.is_empty() else taxonomy
			entries.add_child(_label("%s — %s" % [str(landmark.name), detail.to_upper()], 16, Color("#d3dec5")))
	var back := _button("Back", 18)
	back.pressed.connect(show_pause if back_mode == "pause" else show_title)
	box.add_child(back)

func show_level_select() -> void:
	menu_mode = "levels"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.visible = false
	_clear_style_flash()
	style_award_feed.clear_feed()
	grapple_reticle.clear_target()
	_clear_menu()
	var panel := _center_panel(Vector2(780.0, 610.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	box.add_child(_label("Choose an expedition", 34, Color("#edf3d5")))
	box.add_child(_label("One persistent world. Survival and movement carry the run.", 16, Color("#aabda1")))
	var grid := GridContainer.new()
	grid.columns = 1
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 8)
	box.add_child(grid)
	for level in LEVELS.all_levels():
		var button := _button(level.title + "\nSURVIVAL TRAVERSAL  -  DETERMINISTIC WORLD\nF3 DIAGNOSTICS", 16)
		button.custom_minimum_size = Vector2(700.0, 72.0)
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.tooltip_text = level.briefing
		button.pressed.connect(start_level.bind(level.id))
		grid.add_child(button)
	var bottom := HBoxContainer.new()
	bottom.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bottom.add_theme_constant_override("separation", 12)
	box.add_child(bottom)
	var back := _button("Back", 16)
	back.custom_minimum_size.x = 160.0
	back.pressed.connect(show_title)
	bottom.add_child(back)
	var settings := _button("Settings", 16)
	settings.custom_minimum_size.x = 160.0
	settings.pressed.connect(show_settings.bind("levels"))
	bottom.add_child(settings)

func start_level(level_id: String) -> void:
	if photo_mode and photo_mode.active:
		photo_mode.toggle()
	if creative_editor and creative_editor.is_open():
		creative_editor.close()
	creative_session = false
	get_tree().paused = false
	_clear_menu()
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	current_level = LEVELS.by_id(level_id)
	collected_in_level = 0
	grapple_reticle.clear_target()
	_clear_style_flash()
	style_award_feed.clear_feed()
	_build_course(current_level)
	var run_seed := int(current_level.get("seed", _seed_for_level(level_id)))
	RunData.begin_run(level_id, run_seed)
	world_journal = WORLD_SURVEY_JOURNAL.new()
	survival_movement = {}
	run_balance_telemetry = SURVIVAL_TRAVERSAL_TELEMETRY.new()
	if bool(current_level.get("procedural", false)):
		Survival.begin_run(run_seed)
		weather_clock = 0.0
		weather_forecast_key = ""
		weather_forecast.clear()
		survey_check_time = 0.0
		world_journal.survey_region(current_region)
	hud.visible = true
	debug_panel.visible = debug_visible
	briefing_label.modulate.a = 1.0
	briefing_label.text = current_level.title + " - " + current_level.briefing
	var tween := create_tween()
	tween.tween_property(briefing_label, "modulate:a", 0.0, 0.3).set_delay(4.0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_refresh_hud()

func _open_creative_mode() -> void:
	get_tree().paused = false
	_clear_menu()
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	RunData.running = false
	hud.visible = false
	debug_panel.visible = false
	_clear_style_flash()
	if creative_document == null:
		var draft_path := "res://levels/_drafts/creative-draft.level.json"
		if FileAccess.file_exists(draft_path):
			creative_document = LEVEL_DOCUMENT.load_from_path(draft_path)
		else:
			creative_document = LEVEL_DOCUMENT.load_from_path("res://levels/sandbox.level.json").duplicate_document()
			creative_document.data["id"] = "creative-draft"
			creative_document.data["title"] = "Creative Draft"
			creative_document.data["status"] = "draft"
			creative_document.save_to_path(draft_path)
	creative_session = true
	_build_creative_course()
	creative_editor.configure(self, creative_document, creative_geometry_root)
	creative_editor.open()

func _build_creative_course() -> void:
	_clear_playtest_visuals()
	if course:
		course.queue_free()
	course = Node3D.new()
	course.name = "CreativeCourse"
	course.set_meta("layout_id", str(creative_document.data.get("id", "creative-draft")))
	add_child(course)
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
	grapple_anchor_count = 0
	combo_gap_count = 0
	recharge_gate_count = 0
	trigger_count = 0
	sandbox_stations.clear()
	current_station = "Creative"
	last_sandbox_event = "CREATIVE DRAFT"
	_add_creative_lighting()
	creative_geometry_root = Node3D.new()
	creative_geometry_root.name = "AuthoringGeometry"
	course.add_child(creative_geometry_root)
	creative_build_index = LEVEL_BUILDER.build_index(self, creative_document, creative_geometry_root)
	var spawn: Variant = LEVEL_DOCUMENT.vector_from(creative_document.data.get("spawn", [0.0, 1.1, 3.0]))
	player_spawn = spawn if spawn != null else Vector3(0.0, 1.1, 3.0)
	player = SpeedPlayer.new()
	player.position = player_spawn
	player.movement_enabled = false
	player.reset_requested.connect(_bail_to_start)
	player.traversal_action.connect(_on_traversal_action)
	player.combo_landed.connect(_on_combo_landed)
	player.hard_landed.connect(_on_hard_landed)
	course.add_child(player)

func _rebuild_creative_geometry(change: Dictionary = {}) -> void:
	if not creative_session or course == null or creative_document == null:
		return
	if creative_geometry_root == null:
		creative_geometry_root = Node3D.new()
		creative_geometry_root.name = "AuthoringGeometry"
		course.add_child(creative_geometry_root)
		creative_build_index = LEVEL_BUILDER.build_index(self, creative_document, creative_geometry_root)
	else:
		creative_build_index = LEVEL_BUILDER.apply_changes(self, creative_document, creative_geometry_root, creative_build_index, change.get("changed_module_ids", ["*"]), bool(change.get("full_rebuild", false)), bool(change.get("references_changed", false)))
	_recount_creative_content()
	creative_editor.set_geometry_root(creative_geometry_root)

func _add_creative_lighting() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("#17231d")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("#92a87d")
	settings.ambient_light_energy = 0.75
	environment.environment = settings
	course.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52.0, -36.0, 0.0)
	sun.light_color = Color("#d4d7ac")
	sun.light_energy = 1.25
	course.add_child(sun)

func _playtest_creative_draft() -> void:
	if player == null:
		return
	current_level = {"id": str(creative_document.data.get("id", "creative-draft")), "title": str(creative_document.data.get("title", "Creative Draft")), "briefing": "Creative draft playtest."}
	RunData.begin_run(str(current_level.get("id", "creative-draft")))
	_clear_playtest_visuals()
	creative_playtest = {"started_at": Time.get_datetime_string_from_system(true), "events": [], "path": [], "checkpoints": [], "checkpoint_times": {}, "heatmap": {}, "max_speed": 0.0, "resets": 0}
	creative_sample_timer = 0.0
	player.reset_for_bail(player_spawn)
	player.movement_enabled = true
	hud.visible = true
	debug_panel.visible = debug_visible
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	last_sandbox_event = "CREATIVE PLAYTEST"
	_refresh_hud()

func _return_to_creative_editor() -> void:
	if not creative_session or player == null:
		return
	_finalize_creative_playtest()
	RunData.running = false
	player.movement_enabled = false
	hud.visible = false
	debug_panel.visible = false
	creative_editor.open()

func _record_creative_sample(delta: float) -> void:
	if not creative_session or creative_playtest.is_empty() or player == null:
		return
	var speed := Vector2(player.velocity.x, player.velocity.z).length()
	creative_playtest["max_speed"] = maxf(float(creative_playtest.get("max_speed", 0.0)), speed)
	creative_sample_timer -= delta
	if creative_sample_timer > 0.0:
		return
	creative_sample_timer = 0.25
	var path: Array = creative_playtest.get("path", [])
	path.append([player.global_position.x, player.global_position.y, player.global_position.z, RunData.elapsed])
	creative_playtest["path"] = path
	var cells: Dictionary = creative_playtest.get("heatmap", {})
	var cell_x := int(floor(player.global_position.x / 4.0))
	var cell_z := int(floor(player.global_position.z / 4.0))
	var key := str(cell_x) + ":" + str(cell_z)
	var cell: Dictionary = cells.get(key, {"cell": [cell_x, cell_z], "samples": 0})
	cell["samples"] = int(cell.get("samples", 0)) + 1
	cells[key] = cell
	creative_playtest["heatmap"] = cells

func _record_creative_event(kind: String, detail := "") -> void:
	if not creative_session or creative_playtest.is_empty():
		return
	var events: Array = creative_playtest.get("events", [])
	events.append({"time": RunData.elapsed, "kind": kind, "detail": detail})
	creative_playtest["events"] = events

func _finalize_creative_playtest() -> void:
	if creative_playtest.is_empty() or creative_document == null:
		return
	creative_playtest["elapsed"] = RunData.elapsed
	creative_playtest["style"] = RunData.style_snapshot()
	creative_playtest["collected"] = RunData.collected
	var heatmap: Array = []
	for cell in creative_playtest.get("heatmap", {}): heatmap.append(creative_playtest.get("heatmap", {})[cell])
	creative_playtest["heatmap"] = heatmap
	var missed: Array = []
	var reached: Array = creative_playtest.get("checkpoints", [])
	for module in creative_document.modules():
		if module is Dictionary and str(module.get("kind", "")) == "checkpoint" and not reached.has(str(module.get("id", ""))): missed.append(str(module.get("id", "")))
	creative_playtest["missed_checkpoints"] = missed
	var saved: Dictionary = creative_document.save_playtest_report(creative_playtest)
	if bool(saved.get("ok", false)):
		creative_editor.set_playtest_reports(creative_document.playtest_reports())
	creative_playtest.clear()

func toggle_playtest_ghost(report: Dictionary) -> void:
	if creative_ghost and is_instance_valid(creative_ghost):
		creative_ghost.queue_free()
		creative_ghost = null
		creative_ghost_path.clear()
		return
	if course == null or not report.get("path", []) is Array or (report.get("path", []) as Array).size() < 2: return
	creative_ghost_path = report.get("path", [])
	creative_ghost_elapsed = 0.0
	creative_ghost = MeshInstance3D.new()
	creative_ghost.name = "PlaytestGhost"
	var mesh := SphereMesh.new()
	mesh.radius = 0.36
	mesh.height = 0.72
	creative_ghost.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.48, 0.88, 1.0, 0.46)
	material.emission_enabled = true
	material.emission = Color(0.24, 0.72, 1.0)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	creative_ghost.material_override = material
	course.add_child(creative_ghost)

func toggle_playtest_heatmap(report: Dictionary) -> void:
	if creative_heatmap_root and is_instance_valid(creative_heatmap_root):
		creative_heatmap_root.queue_free()
		creative_heatmap_root = null
		return
	if course == null or not report.get("heatmap", []) is Array: return
	creative_heatmap_root = Node3D.new()
	creative_heatmap_root.name = "PlaytestHeatmap"
	for entry in report.get("heatmap", []):
		if not entry is Dictionary: continue
		var cell: Variant = entry.get("cell", [])
		if not cell is Array or cell.size() != 2: continue
		var samples := int(entry.get("samples", 0))
		var marker := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(3.7, 0.05 + minf(float(samples) * 0.07, 1.4), 3.7)
		marker.mesh = box
		marker.position = Vector3((float(cell[0]) + 0.5) * 4.0, box.size.y * 0.5 + 0.03, (float(cell[1]) + 0.5) * 4.0)
		var material := StandardMaterial3D.new()
		var intensity := clampf(float(samples) / 12.0, 0.12, 1.0)
		material.albedo_color = Color(1.0, 0.44 + intensity * 0.4, 0.18, 0.18 + intensity * 0.46)
		material.emission_enabled = true
		material.emission = Color(0.9 * intensity, 0.3 * intensity, 0.06)
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		marker.material_override = material
		creative_heatmap_root.add_child(marker)
	course.add_child(creative_heatmap_root)

func _advance_playtest_ghost(delta: float) -> void:
	if creative_ghost == null or not is_instance_valid(creative_ghost) or creative_ghost_path.size() < 2: return
	var last: Variant = creative_ghost_path[creative_ghost_path.size() - 1]
	if not last is Array or last.size() < 4: return
	creative_ghost_elapsed = fmod(creative_ghost_elapsed + delta, maxf(float(last[3]), 0.1))
	for index in range(creative_ghost_path.size() - 1):
		var first: Variant = creative_ghost_path[index]
		var second: Variant = creative_ghost_path[index + 1]
		if not first is Array or not second is Array or first.size() < 4 or second.size() < 4: continue
		if creative_ghost_elapsed <= float(second[3]):
			var interval := maxf(float(second[3]) - float(first[3]), 0.001)
			var blend := clampf((creative_ghost_elapsed - float(first[3])) / interval, 0.0, 1.0)
			creative_ghost.position = Vector3(float(first[0]), float(first[1]), float(first[2])).lerp(Vector3(float(second[0]), float(second[1]), float(second[2])), blend)
			return

func _clear_playtest_visuals() -> void:
	if creative_ghost and is_instance_valid(creative_ghost): creative_ghost.queue_free()
	if creative_heatmap_root and is_instance_valid(creative_heatmap_root): creative_heatmap_root.queue_free()
	creative_ghost = null
	creative_heatmap_root = null
	creative_ghost_path.clear()

func _recount_creative_content() -> void:
	if not creative_session or creative_geometry_root == null:
		return
	trigger_count = creative_geometry_root.find_children("*", "CourseTrigger", true, false).size()
	grapple_anchor_count = creative_geometry_root.get_tree().get_nodes_in_group("grapple_anchor").filter(func(node): return creative_geometry_root.is_ancestor_of(node)).size()

func _exit_creative_mode() -> void:
	_clear_playtest_visuals()
	creative_session = false
	RunData.running = false
	if player:
		player.movement_enabled = false
	show_title()

func _build_course(level: Dictionary) -> void:
	if course:
		course.queue_free()
	world_streamer = null
	current_region = {}
	if bool(level.get("procedural", false)):
		_load_expedition(level)
		return
	if level.has("document_path"):
		_load_document_level(level)
		return
	if not geometry_export_mode:
		_load_baked_sandbox(level)
		return
	course = Node3D.new()
	course.name = "Course"
	course.set_meta("layout_id", level.id)
	course.set_meta("focus", level.focus)
	add_child(course)
	_add_forest_motes()
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
	grapple_anchor_count = 0
	combo_gap_count = 0
	recharge_gate_count = 0
	trigger_count = 0
	sandbox_stations.clear()
	current_station = "Central Plaza"
	last_sandbox_event = "Session started"
	var world_length := float(level.world_length)
	var world_width := float(level.world_width)
	var palette := _palette_for(str(level.terrain_style))
	var summit_surface := Vector3(0.0, 7.2, -world_length + 8.0)
	var basin := _make_platform(Vector3(0.0, -0.45, -world_length * 0.5 + 4.0), Vector3(world_width, 0.9, world_length + 20.0), palette.basin)
	basin.name = "OpenBasin"
	basin.set_meta("recovery_floor", true)
	course.add_child(basin)
	var start_floor := _make_platform(Vector3(0.0, 0.0, 2.0), Vector3(13.0, 0.7, 11.0), palette.start)
	start_floor.name = "Start"
	course.add_child(start_floor)
	player = SpeedPlayer.new()
	player_spawn = Vector3(0.0, 0.9, 3.0)
	player.position = player_spawn
	player.reset_requested.connect(_bail_to_start)
	player.traversal_action.connect(_on_traversal_action)
	player.combo_landed.connect(_on_combo_landed)
	player.hard_landed.connect(_on_hard_landed)
	course.add_child(player)
	_build_open_terrain(world_length, world_width, str(level.terrain_style))
	_build_sandbox(palette)

func _load_document_level(level: Dictionary) -> void:
	var document: Variant = LEVEL_DOCUMENT.load_from_path(str(level.get("document_path", "")))
	course = Node3D.new()
	course.name = "Course"
	course.set_meta("layout_id", str(document.data.get("id", level.get("id", "creative-level"))))
	course.set_meta("focus", str(document.data.get("focus", level.get("focus", "full style kit"))))
	add_child(course)
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
	grapple_anchor_count = 0
	combo_gap_count = 0
	recharge_gate_count = 0
	trigger_count = 0
	sandbox_stations.clear()
	current_station = "Creative"
	last_sandbox_event = "PUBLISHED LEVEL"
	_add_creative_lighting()
	var geometry := Node3D.new()
	geometry.name = "LevelGeometry"
	course.add_child(geometry)
	LEVEL_BUILDER.build(self, document, geometry)
	var spawn: Variant = LEVEL_DOCUMENT.vector_from(document.data.get("spawn", [0.0, 1.1, 3.0]))
	player_spawn = spawn if spawn != null else Vector3(0.0, 1.1, 3.0)
	player = SpeedPlayer.new()
	player.position = player_spawn
	player.reset_requested.connect(_bail_to_start)
	player.traversal_action.connect(_on_traversal_action)
	player.combo_landed.connect(_on_combo_landed)
	player.hard_landed.connect(_on_hard_landed)
	course.add_child(player)

func _load_baked_sandbox(level: Dictionary) -> void:
	course = SANDBOX_GEOMETRY.instantiate()
	course.name = "Course"
	course.set_meta("layout_id", level.id)
	course.set_meta("focus", level.focus)
	add_child(course)
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
	grapple_anchor_count = 0
	combo_gap_count = 0
	recharge_gate_count = 0
	trigger_count = 0
	sandbox_stations.clear()
	current_station = "Central Plaza"
	last_sandbox_event = "Session started"
	for route in course.get_children():
		if route is Node3D and route.has_meta("station"):
			var station_name := str(route.get_meta("station"))
			var center: Variant = SANDBOX_STATION_CENTERS.get(station_name, route.global_position)
			sandbox_stations.append({"name": station_name, "center": center})
	for node in course.find_children("*", "", true, false):
		if node.has_meta("traversal_ramp"):
			traversal_ramp_count += 1
		if node.has_meta("climbable_trunk"):
			climbable_trunk_count += 1
		if node.get_meta("tool", "") == "grapple":
			grapple_anchor_count += 1
		if node.has_meta("gap_id"):
			combo_gap_count += 1
	for trigger in course.find_children("*", "CourseTrigger", true, false):
		trigger.callback = _on_trigger
		trigger_count += 1
		if trigger.trigger_type == CourseTrigger.TriggerType.COLLECTIBLE:
			total_collectibles_in_level += 1
		if trigger.trigger_type == CourseTrigger.TriggerType.RECHARGE:
			recharge_gate_count += 1
	player = SpeedPlayer.new()
	player_spawn = Vector3(0.0, 0.9, 3.0)
	player.position = player_spawn
	player.reset_requested.connect(_bail_to_start)
	player.traversal_action.connect(_on_traversal_action)
	player.combo_landed.connect(_on_combo_landed)
	player.hard_landed.connect(_on_hard_landed)
	course.add_child(player)

func _load_expedition(level: Dictionary) -> void:
	course = Node3D.new()
	course.name = "Expedition"
	course.set_meta("layout_id", "expedition")
	course.set_meta("focus", "infinite survival traversal")
	add_child(course)
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
	grapple_anchor_count = 0
	combo_gap_count = 0
	recharge_gate_count = 0
	trigger_count = 0
	sandbox_stations.clear()
	current_station = "Unknown"
	last_sandbox_event = "EXPEDITION START"
	_add_expedition_lighting()
	player = SpeedPlayer.new()
	player.position = Vector3(0.0, 8.0, 0.0)
	player.reset_requested.connect(_bail_to_start)
	player.traversal_action.connect(_on_traversal_action)
	player.combo_landed.connect(_on_combo_landed)
	player.hard_landed.connect(_on_hard_landed)
	course.add_child(player)
	world_streamer = WORLD_STREAMER.new()
	course.add_child(world_streamer)
	world_streamer.region_changed.connect(_on_expedition_region_changed)
	world_streamer.chunk_stats_changed.connect(_on_chunk_stats_changed)
	world_streamer.streaming_hitch.connect(_on_streaming_hitch)
	var seed := int(level.get("seed", _seed_for_level(str(level.get("id", "expedition")))))
	world_streamer.configure(seed, player)
	player_spawn = Vector3(0.0, world_streamer.ground_height(Vector3.ZERO) + 1.2, 0.0)
	player.global_position = player_spawn
	photo_mode.configure(player, hud, Callable(self, "_photo_metadata"), expedition_environment)
	current_region = world_streamer.sample_at(player.global_position).get("region", {})

func _add_expedition_lighting() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("#172923")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("#9eb98b")
	settings.ambient_light_energy = 0.82
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	settings.fog_enabled = true
	settings.fog_light_color = Color("#9ab39d")
	settings.fog_density = 0.008
	environment.environment = settings
	expedition_environment = settings
	course.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48.0, -34.0, 0.0)
	sun.light_color = Color("#e4d7af")
	sun.light_energy = 1.15
	course.add_child(sun)
	expedition_sun = sun
	weather_particles = GPUParticles3D.new()
	weather_particles.name = "WeatherParticles"
	weather_particles.lifetime = 1.8
	weather_particles.local_coords = false
	weather_particles.visibility_aabb = AABB(Vector3(-20.0,-12.0,-20.0),Vector3(40.0,24.0,40.0))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(16.0,2.0,16.0)
	process.direction = Vector3(0.0,-1.0,0.0)
	process.spread = 18.0
	process.initial_velocity_min = 7.0
	process.initial_velocity_max = 11.0
	process.color = Color("#d6e8efaa")
	weather_particles.process_material = process
	weather_particles.draw_pass_1 = _particle_quad(0.06,Color("#d6e8efaa"))
	weather_particles.visible = false
	course.add_child(weather_particles)

func _apply_expedition_atmosphere(weather: Dictionary) -> void:
	if expedition_environment == null or expedition_sun == null: return
	var atmosphere: Dictionary = WORLD_ATMOSPHERE.presentation(weather, {"clock":weather_clock})
	var layers: Dictionary = WEATHER_LAYERS.profile(weather)
	expedition_environment.background_color = atmosphere.background
	expedition_environment.ambient_light_color = atmosphere.ambient
	expedition_environment.fog_light_color = atmosphere.fog
	expedition_environment.fog_density = float(atmosphere.fog_density)
	expedition_sun.light_color = atmosphere.sun_color
	expedition_sun.light_energy = float(atmosphere.sun_energy)
	expedition_sun.rotation_degrees = atmosphere.sun_rotation
	if weather_particles:
		var particle_count := int(layers.particles)
		weather_particles.amount = maxi(particle_count,1)
		weather_particles.visible = particle_count > 0
		if player: weather_particles.global_position = player.global_position + Vector3(0.0,8.0,0.0)
	Audio.set_weather_cue(str(layers.audio), float(layers.opacity))

func _on_expedition_region_changed(region: Dictionary) -> void:
	current_region = region
	RunData.discover_region(str(region.get("id", "")))
	world_journal.survey_region(region)
	current_station = str(region.get("name", "Unknown"))
	last_sandbox_event = "ENTERED " + current_station.to_upper()
func _on_chunk_stats_changed(stats: Dictionary) -> void:
	if bool(current_level.get("procedural", false)):
		last_sandbox_event = "CHUNKS " + str(stats.get("active", 0))

func _on_streaming_hitch(sample: Dictionary) -> void:
	streaming_profile.record_hitch(sample)

func _toggle_streaming_profile() -> void:
	if not RunData.running or not bool(current_level.get("procedural", false)) or world_streamer == null:
		return
	if streaming_profile.active:
		var path := streaming_profile.export()
		streaming_profile_sample_time = 0.0
		_show_streaming_profile_notice("STREAM PROFILE SAVED" if not path.is_empty() else "STREAM PROFILE EXPORT FAILED")
		if not path.is_empty():
			print("STREAMING_PROFILE " + path)
		return
	streaming_profile.begin({"level":str(current_level.get("id", "")),"seed":int(current_level.get("seed", 0))})
	streaming_profile_sample_time = 0.0
	_show_streaming_profile_notice("STREAM PROFILE RECORDING")

func _record_streaming_profile(delta: float) -> void:
	if not streaming_profile.active or world_streamer == null or player == null:
		return
	streaming_profile_sample_time += delta
	if streaming_profile_sample_time < 1.0:
		return
	streaming_profile_sample_time = fmod(streaming_profile_sample_time, 1.0)
	streaming_profile.record_sample(float(Engine.get_frames_per_second()), frame_time * 1000.0, world_streamer.streaming_diagnostics(), player.global_position, current_region)

func _show_streaming_profile_notice(text: String) -> void:
	last_sandbox_event = text
	if briefing_label == null:
		return
	briefing_label.text = text
	briefing_label.add_theme_color_override("font_color", Color("#9edbb8"))
	briefing_label.modulate.a = 1.0
	var tween := create_tween()
	tween.tween_property(briefing_label, "modulate:a", 0.0, 0.35).set_delay(1.4)

func _on_survival_depleted(reason: String) -> void:
	if not RunData.running or not bool(current_level.get("procedural", false)):
		return
	var snapshot := Survival.snapshot()
	snapshot["failure"] = reason
	last_resolved_run = RunData.finish("failed", snapshot)
	_export_resolved_run(run_archive.append(last_resolved_run))
	last_sandbox_event = "RUN FAILED: " + reason.to_upper()
	if player: player.movement_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	show_failure_resolution(reason)

func show_failure_resolution(reason: String) -> void:
	menu_mode = "failure"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	get_tree().paused = false
	_clear_menu()
	var panel := _center_panel(Vector2(460.0, 300.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Expedition failed", 34, Color("#f1c38b")))
	box.add_child(_label("Cause: " + reason.replace("_", " ").to_upper(), 17, Color("#d7b999")))
	box.add_child(_label("Elapsed " + _time_text(float(last_resolved_run.get("elapsed", 0.0))) + "  /  Resources " + str((last_resolved_run.get("resources", {}) as Dictionary).size()), 15, Color("#b5c6a5")))
	var retry := _button("Retry expedition", 19)
	retry.pressed.connect(func(): start_level(str(current_level.get("id", "expedition"))))
	box.add_child(retry)
	var title := _button("Return to title", 19)
	title.pressed.connect(show_title)
	box.add_child(title)

func show_extraction_confirm() -> void:
	if not RunData.running or not bool(current_level.get("procedural", false)): return
	menu_mode = "extract"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_clear_menu()
	var panel := _center_panel(Vector2(430.0, 260.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Extract from expedition?", 28, Color("#edf3d5")))
	box.add_child(_label("Bank the current run record and return to title.", 16, Color("#b5c6a5")))
	var extract := _button("Extract now", 19)
	extract.pressed.connect(_extract_run)
	box.add_child(extract)
	var cancel := _button("Continue expedition", 19)
	cancel.pressed.connect(resume_run)
	box.add_child(cancel)

func _extract_run() -> void:
	if not RunData.running: return
	last_resolved_run = RunData.finish("extracted", Survival.snapshot())
	_export_resolved_run(run_archive.append(last_resolved_run))
	last_sandbox_event = "RUN EXTRACTED"
	get_tree().paused = false
	if player: player.movement_enabled = false
	show_title()

func _on_hard_landed(injury: float) -> void:
	if not RunData.running or not bool(current_level.get("procedural", false)):
		return
	Survival.apply_injury(injury)
	last_sandbox_event = "INJURY %02d" % int(ceilf(injury))
	_show_encounter_feedback(WILDLIFE_FEEDBACK.injury(injury))

func _attempt_material_placement() -> void:
	if player == null or world_streamer == null: return
	var forward := -player.global_transform.basis.z
	forward.y = 0.0
	if forward.length() < 0.1: forward = Vector3.FORWARD
	var target := player.global_position + forward.normalized() * 1.5
	target.y = world_streamer.ground_height(target)
	var surface: Dictionary = world_streamer.sample_at(target)
	var gate := TRAVERSAL_MATERIAL_PLACEMENT.evaluate({"on_floor": player.is_on_floor(), "planar_speed": Vector2(player.velocity.x, player.velocity.z).length(), "traversal_active": player.style_multiplier_active()}, {"distance": player.global_position.distance_to(target), "slope": float(surface.get("slope", 0.0)), "water": bool(surface.get("water", false))}, Survival.scavenged_materials())
	if not bool(gate.allowed):
		last_sandbox_event = "PLACE " + str(gate.reason).replace("_", " ").to_upper()
		return
	if not world_streamer.place_material_marker(target, {"type": "route_marker", "cost": gate.cost}):
		last_sandbox_event = "PLACE TARGET UNAVAILABLE"
		return
	Survival.spend_materials(gate.cost)
	last_sandbox_event = "PLACE ROUTE MARKER"

func _attempt_shelter_construction() -> void:
	if player == null or world_streamer == null: return
	var surface: Dictionary = world_streamer.sample_at(player.global_position)
	var gate := TRAVERSAL_MATERIAL_PLACEMENT.evaluate({"on_floor": player.is_on_floor(), "planar_speed": Vector2(player.velocity.x, player.velocity.z).length(), "traversal_active": player.style_multiplier_active()}, {"distance": 0.0, "slope": float(surface.get("slope", 0.0)), "water": bool(surface.get("water", false))}, Survival.scavenged_materials(), SHELTER_COST)
	if not bool(gate.allowed):
		last_sandbox_event = "SHELTER " + str(gate.reason).replace("_", " ").to_upper()
		return
	var position := player.global_position
	position.y = world_streamer.ground_height(position)
	if not world_streamer.place_temporary_shelter(position, {"type": "shelter", "cost": gate.cost}):
		last_sandbox_event = "SHELTER TARGET UNAVAILABLE"
		return
	Survival.spend_materials(gate.cost)
	last_sandbox_event = "SHELTER BUILT"

func _attempt_platform_construction() -> void:
	if player == null or world_streamer == null: return
	var forward := -player.global_transform.basis.z
	forward.y = 0.0
	if forward.length() < 0.1: forward = Vector3.FORWARD
	var target := player.global_position + forward.normalized() * 2.1
	target.y = world_streamer.ground_height(target)
	var surface: Dictionary = world_streamer.sample_at(target)
	var gate := TRAVERSAL_MATERIAL_PLACEMENT.evaluate({"on_floor": player.is_on_floor(), "planar_speed": Vector2(player.velocity.x, player.velocity.z).length(), "traversal_active": player.style_multiplier_active()}, {"distance": player.global_position.distance_to(target), "slope": float(surface.get("slope", 0.0)), "water": bool(surface.get("water", false))}, Survival.scavenged_materials(), PLATFORM_COST)
	if not bool(gate.allowed):
		last_sandbox_event = "PLATFORM " + str(gate.reason).replace("_", " ").to_upper()
		return
	if not world_streamer.place_temporary_platform(target, forward, {"type": "platform", "cost": gate.cost}):
		last_sandbox_event = "PLATFORM TARGET UNAVAILABLE"
		return
	Survival.spend_materials(gate.cost)
	last_sandbox_event = "PLATFORM BUILT"

func _craft_field_filter() -> void:
	if Survival.craft("water_filter"):
		last_sandbox_event = "CRAFT WATER FILTER"
	else:
		last_sandbox_event = "CRAFT MATERIALS REQUIRED"

func _photo_metadata() -> Dictionary:
	var world_data: Dictionary = world_streamer.sample_at(player.global_position) if world_streamer and player else {}
	return {"run": RunData.run_record(Survival.snapshot()), "world": world_data, "position": [player.global_position.x, player.global_position.y, player.global_position.z] if player else []}

func _on_photo_captured(image_path: String, metadata_path: String) -> void:
	var exported := RUN_EXPORT.export_photo(image_path, metadata_path)
	if not exported.is_empty(): last_sandbox_event = "PHOTO EXPORTED"

func _export_resolved_run(record: Dictionary) -> void:
	if record.is_empty(): return
	_export_seed(int(record.get("seed", 0)))
	_export_run_card(record)

func _export_seed(seed: int) -> void:
	var path := RUN_EXPORT.export_seed(seed)
	if not path.is_empty(): last_sandbox_event = "SEED EXPORTED"

func _export_run_card(record: Dictionary) -> void:
	var path := RUN_EXPORT.export_run_card(record)
	if not path.is_empty(): last_sandbox_event = "RUN CARD EXPORTED"

func _seed_for_level(level_id: String) -> int:
	var value := 17
	for index in range(level_id.length()):
		value = (value * 31 + level_id.unicode_at(index)) & 0x7fffffff
	return value

func _route(name: String, focus: String) -> Node3D:
	var route := Node3D.new()
	route.name = name
	route.set_meta("focus", focus)
	course.add_child(route)
	return route

func _add_route_path(route: Node3D, points: Array[Vector3], platform_size: Vector3, ramp_width: float, platform_color: Color, ramp_color: Color) -> void:
	for point in points:
		route.add_child(_make_platform(point - Vector3(0.0, platform_size.y * 0.5, 0.0), platform_size, platform_color))
	for index in range(points.size() - 1):
		route.add_child(_make_ramp_between(points[index], points[index + 1], ramp_width, ramp_color))

func _add_route_islands(route: Node3D, points: Array[Vector3], platform_size: Vector3, color: Color) -> void:
	for point in points:
		route.add_child(_make_platform(point - Vector3(0.0, platform_size.y * 0.5, 0.0), platform_size, color))

func _add_route_collectibles(route: Node3D, positions: Array[Vector3]) -> void:
	for position in positions:
		total_collectibles_in_level += 1
		route.add_child(_make_collectible(position))

func _add_arena_gaps(parent: Node3D, positions: Array[Vector3], id_prefix: String, points: int) -> void:
	for index in range(positions.size()):
		parent.add_child(_make_combo_gap(positions[index] + Vector3(0.0, 1.75, 0.0), id_prefix + "-" + str(index + 1), points))

func _add_course_sign(parent: Node3D, position: Vector3, text: String, color: Color) -> void:
	var sign := Label3D.new()
	sign.name = "FocusSign"
	sign.position = position
	sign.text = text
	sign.font = ui_theme.default_font
	sign.font_size = 44
	sign.outline_size = 6
	sign.modulate = color
	sign.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sign.pixel_size = 0.008
	parent.add_child(sign)

func _build_sandbox(palette: Dictionary) -> void:
	var central := _sandbox_station("CentralPlaza", "CENTRAL PLAZA", Vector3(0.0, 0.5, 1.0))
	central.add_child(_make_platform(Vector3(0.0, 0.0, -5.0), Vector3(28.0, 0.8, 24.0), palette.start))
	central.add_child(_make_reset_pad(Vector3(8.0, 0.55, 4.0), player_spawn, "Central Plaza", true))
	_add_course_sign(central, Vector3(0.0, 4.4, -3.0), "SANDBOX  /  BUILD STYLE  /  F3 DEBUG", palette.sign)

	var movement := _sandbox_station("MovementPlaza", "MOVEMENT PLAZA", Vector3(0.0, 1.5, -24.0))
	var movement_points: Array[Vector3] = [Vector3(0.0, 0.5, -13.0), Vector3(-7.0, 1.4, -23.0), Vector3(0.0, 2.7, -33.0), Vector3(8.0, 1.6, -24.0), Vector3(0.0, 0.8, -15.0)]
	_add_route_path(movement, movement_points, Vector3(8.6, 0.72, 7.0), 5.8, palette.safe, palette.ramp)
	movement.add_child(_make_boost(Vector3(-3.5, 0.85, -17.0), Vector3(0.0, 0.0, -1.0)))
	movement.add_child(_make_boost(Vector3(4.0, 2.05, -29.0), Vector3(0.7, 0.0, 0.4).normalized()))
	movement.add_child(_make_recharge_gate(Vector3(0.0, 3.9, -33.0), "dash", "movement-dash"))
	_add_root_arch(movement, Vector3(0.0, 0.0, -23.5), 7.2, palette.root)
	_add_route_collectibles(movement, [Vector3(-7.0, 2.8, -23.0), Vector3(0.0, 4.0, -33.0), Vector3(8.0, 3.0, -24.0)])
	movement.add_child(_make_reset_pad(Vector3(0.0, 1.0, -15.0), Vector3(0.0, 1.2, -15.0), "Movement Plaza"))
	_add_course_sign(movement, Vector3(0.0, 5.0, -24.0), "SPRINT  /  SLIDE  /  BOOST", palette.sign)

	var gaps := _sandbox_station("GapYard", "GAP YARD", Vector3(-31.0, 2.5, -47.0))
	var gap_points: Array[Vector3] = [Vector3(-18.0, 0.8, -33.0), Vector3(-27.0, 2.2, -43.0), Vector3(-35.0, 4.2, -52.0), Vector3(-27.0, 5.8, -62.0), Vector3(-18.0, 4.0, -56.0)]
	_add_route_islands(gaps, gap_points, Vector3(5.0, 0.7, 5.0), palette.expert)
	gaps.add_child(_make_ramp_between(Vector3(-8.0, 0.6, -25.0), gap_points[0], 4.2, palette.ramp))
	_add_arena_gaps(gaps, [gap_points[1], gap_points[2], gap_points[3]], "sandbox-gap", 320)
	gaps.add_child(_make_recharge_gate(Vector3(-35.0, 7.8, -52.0), "double_jump", "gaps-jump"))
	_add_route_collectibles(gaps, [Vector3(-27.0, 3.7, -43.0), Vector3(-35.0, 5.7, -52.0), Vector3(-27.0, 7.3, -62.0)])
	gaps.add_child(_make_reset_pad(Vector3(-18.0, 1.3, -33.0), Vector3(-18.0, 1.4, -33.0), "Gap Yard"))
	_add_course_sign(gaps, Vector3(-31.0, 8.0, -49.0), "DOUBLE JUMP  /  AIR DASH  /  GAPS", palette.sign)

	var tower := _sandbox_station("WallTower", "WALL TOWER", Vector3(30.0, 3.0, -47.0))
	_add_interior_building(tower, Vector3(30.0, 0.0, -48.0), Vector2(22.0, 26.0), 13.0, palette.root)
	var tower_points: Array[Vector3] = [Vector3(21.0, 0.6, -38.0), Vector3(24.0, 3.1, -47.0), Vector3(30.0, 5.7, -53.0), Vector3(36.0, 8.3, -47.0), Vector3(39.0, 10.4, -57.0)]
	_add_route_islands(tower, tower_points, Vector3(4.6, 0.7, 4.6), palette.expert)
	for index in range(4):
		_add_climbable_trunk(Vector3(25.0 if index % 2 == 0 else 35.0, 0.0, -43.0 - float(index) * 3.8), 7.0 + float(index), 0.5, tower)
	tower.add_child(_make_recharge_gate(Vector3(36.0, 10.9, -47.0), "dash", "tower-dash"))
	_add_route_collectibles(tower, [Vector3(24.0, 4.4, -47.0), Vector3(30.0, 7.0, -53.0), Vector3(36.0, 9.6, -47.0)])
	tower.add_child(_make_reset_pad(Vector3(21.0, 1.0, -38.0), Vector3(21.0, 1.2, -38.0), "Wall Tower"))
	_add_course_sign(tower, Vector3(30.0, 14.0, -48.0), "WALL RUN  /  WALL KICK", palette.sign)

	var atrium := _sandbox_station("AerialAtrium", "AERIAL ATRIUM", Vector3(-30.0, 5.0, -86.0))
	_add_interior_building(atrium, Vector3(-30.0, 0.0, -86.0), Vector2(24.0, 30.0), 18.0, palette.rock)
	var aerial_points: Array[Vector3] = [Vector3(-20.0, 0.8, -72.0), Vector3(-27.0, 4.4, -82.0), Vector3(-34.0, 8.0, -91.0), Vector3(-28.0, 11.0, -99.0), Vector3(-20.0, 8.0, -91.0)]
	_add_route_islands(atrium, aerial_points, Vector3(5.0, 0.7, 5.0), palette.finale)
	atrium.add_child(_make_launch(Vector3(-20.0, 1.1, -72.0)))
	atrium.add_child(_make_launch(Vector3(-27.0, 4.7, -82.0)))
	for anchor in [Vector3(-27.0, 8.8, -82.0), Vector3(-34.0, 12.4, -91.0), Vector3(-28.0, 15.4, -99.0)]:
		_add_grapple_anchor(atrium, anchor, palette.sign)
	_add_arena_gaps(atrium, [aerial_points[1], aerial_points[2], aerial_points[3]], "sandbox-air", 420)
	atrium.add_child(_make_recharge_gate(Vector3(-34.0, 13.8, -91.0), "dash", "atrium-dash"))
	_add_route_collectibles(atrium, [Vector3(-27.0, 5.9, -82.0), Vector3(-34.0, 9.5, -91.0), Vector3(-28.0, 12.5, -99.0)])
	atrium.add_child(_make_reset_pad(Vector3(-20.0, 1.2, -72.0), Vector3(-20.0, 1.4, -72.0), "Aerial Atrium"))
	_add_course_sign(atrium, Vector3(-30.0, 20.0, -86.0), "TETHER SWING  /  GLIDE", palette.sign)

	var power := _sandbox_station("PowerHall", "POWER HALL", Vector3(29.0, 3.0, -87.0))
	_add_interior_building(power, Vector3(29.0, 0.0, -87.0), Vector2(24.0, 32.0), 11.0, palette.expert)
	var power_points: Array[Vector3] = [Vector3(20.0, 0.8, -72.0), Vector3(28.0, 2.3, -82.0), Vector3(34.0, 4.1, -94.0), Vector3(27.0, 6.3, -103.0), Vector3(20.0, 4.2, -96.0)]
	_add_route_path(power, power_points, Vector3(5.4, 0.7, 6.0), 3.8, palette.expert, palette.ramp)
	for index in range(power_points.size() - 1):
		var direction := Vector3(power_points[index + 1].x - power_points[index].x, 0.0, power_points[index + 1].z - power_points[index].z).normalized()
		power.add_child(_make_boost(power_points[index] + Vector3(0.0, 0.45, -1.0), direction))
	power.add_child(_make_launch(power_points[2] + Vector3(0.0, 0.45, 0.0)))
	power.add_child(_make_recharge_gate(Vector3(34.0, 7.0, -94.0), "double_jump", "power-jump"))
	_add_route_collectibles(power, [Vector3(28.0, 3.5, -82.0), Vector3(34.0, 5.3, -94.0), Vector3(27.0, 7.5, -103.0)])
	power.add_child(_make_reset_pad(Vector3(20.0, 1.2, -72.0), Vector3(20.0, 1.4, -72.0), "Power Hall"))
	_add_course_sign(power, Vector3(29.0, 13.0, -87.0), "BOOST  /  RAMP LAUNCH  /  REFILL", palette.sign)

	var bowl := _sandbox_station("StyleBowl", "STYLE BOWL", Vector3(0.0, 2.0, -119.0))
	var bowl_points: Array[Vector3] = [Vector3(-18.0, 0.8, -108.0), Vector3(-10.0, 2.6, -120.0), Vector3(0.0, 4.2, -127.0), Vector3(11.0, 2.7, -120.0), Vector3(18.0, 0.8, -108.0), Vector3(0.0, 0.8, -103.0)]
	_add_route_path(bowl, bowl_points, Vector3(7.2, 0.72, 6.2), 5.0, palette.finale, palette.ramp)
	bowl.add_child(_make_ramp_between(bowl_points[bowl_points.size() - 1], bowl_points[0], 5.0, palette.ramp))
	_add_arena_gaps(bowl, [bowl_points[1], bowl_points[2], bowl_points[3]], "sandbox-bowl", 520)
	_add_route_collectibles(bowl, [Vector3(-10.0, 4.0, -120.0), Vector3(0.0, 5.7, -127.0), Vector3(11.0, 4.1, -120.0)])
	bowl.add_child(_make_reset_pad(Vector3(0.0, 1.2, -103.0), Vector3(0.0, 1.4, -103.0), "Style Bowl"))
	_add_course_sign(bowl, Vector3(0.0, 9.5, -119.0), "STYLE BOWL  /  SLIDE HOP", palette.sign)

	var line := _sandbox_station("IntegratedLine", "INTEGRATED LINE", Vector3(2.0, 7.0, -81.0))
	var line_points: Array[Vector3] = [Vector3(8.0, 0.8, -12.0), Vector3(18.0, 1.4, -27.0), Vector3(24.0, 4.0, -47.0), Vector3(15.0, 5.4, -66.0), Vector3(2.0, 7.0, -81.0), Vector3(-12.0, 9.0, -98.0), Vector3(-5.0, 7.3, -112.0), Vector3(0.0, 4.2, -127.0)]
	_add_route_path(line, line_points, Vector3(4.8, 0.7, 5.2), 3.4, palette.finale, palette.ramp)
	line.add_child(_make_boost(Vector3(10.0, 1.1, -15.0), Vector3(0.5, 0.0, -0.9).normalized()))
	line.add_child(_make_launch(Vector3(15.0, 5.8, -66.0)))
	_add_grapple_anchor(line, Vector3(-3.0, 12.0, -89.0), palette.sign)
	line.add_child(_make_recharge_gate(Vector3(2.0, 10.5, -81.0), "dash", "line-dash"))
	_add_arena_gaps(line, [line_points[2], line_points[4], line_points[6]], "sandbox-line", 600)
	_add_course_sign(line, Vector3(4.0, 13.0, -78.0), "INTEGRATED LINE  /  NO STOPS", palette.sign)

func _sandbox_station(name: String, label: String, center: Vector3) -> Node3D:
	var station := _route(name, label.to_lower())
	station.set_meta("station", label)
	sandbox_stations.append({"name": label, "center": center})
	return station

func _add_interior_building(parent: Node3D, position: Vector3, size: Vector2, height: float, color: Color) -> void:
	var building := Node3D.new()
	building.name = "InteriorBuilding"
	building.position = position
	building.set_meta("interior", true)
	building.add_child(_make_platform(Vector3(0.0, -0.45, 0.0), Vector3(size.x, 0.9, size.y), color))
	building.add_child(_make_platform(Vector3(-size.x * 0.5, height * 0.5, 0.0), Vector3(0.9, height, size.y), color))
	building.add_child(_make_platform(Vector3(size.x * 0.5, height * 0.5, 0.0), Vector3(0.9, height, size.y), color))
	building.add_child(_make_platform(Vector3(0.0, height * 0.5, -size.y * 0.5), Vector3(size.x, height, 0.9), color))
	building.add_child(_make_platform(Vector3(-size.x * 0.24, height - 0.45, 0.0), Vector3(0.8, 0.8, size.y), color))
	building.add_child(_make_platform(Vector3(size.x * 0.24, height - 0.45, 0.0), Vector3(0.8, 0.8, size.y), color))
	parent.add_child(building)

func _add_grapple_anchor(parent: Node3D, position: Vector3, color: Color) -> void:
	grapple_anchor_count += 1
	var anchor := Node3D.new()
	anchor.name = "GrappleAnchor"
	anchor.position = position
	anchor.add_to_group("grapple_anchor")
	anchor.set_meta("tool", "grapple")
	var ring := MeshInstance3D.new()
	var ring_mesh := TorusMesh.new()
	ring_mesh.inner_radius = 0.56
	ring_mesh.outer_radius = 0.76
	ring.mesh = ring_mesh
	ring.rotation.x = deg_to_rad(90.0)
	ring.material_override = _material(color, true)
	anchor.add_child(ring)
	var core := MeshInstance3D.new()
	var core_mesh := SphereMesh.new()
	core_mesh.radius = 0.20
	core_mesh.height = 0.40
	core.mesh = core_mesh
	core.material_override = _material(Color("#f1ffe5"), true)
	anchor.add_child(core)
	var label := Label3D.new()
	label.text = "E TETHER"
	label.font = ui_theme.default_font
	label.font_size = 28
	label.outline_size = 4
	label.modulate = color
	label.position = Vector3(0.0, 1.0, 0.0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = 0.008
	anchor.add_child(label)
	parent.add_child(anchor)

func _add_root_arch(parent: Node3D, position: Vector3, width: float, color: Color) -> void:
	var arch := Node3D.new()
	arch.name = "RootArch"
	arch.position = position
	for x in [-width * 0.5, width * 0.5]:
		var side := MeshInstance3D.new()
		var side_mesh := CylinderMesh.new()
		side_mesh.top_radius = 0.25
		side_mesh.bottom_radius = 0.42
		side_mesh.height = 3.2
		side.mesh = side_mesh
		side.position = Vector3(x, 1.6, 0.0)
		side.material_override = _material(color)
		arch.add_child(side)
	var crown := MeshInstance3D.new()
	var crown_mesh := CylinderMesh.new()
	crown_mesh.top_radius = 0.28
	crown_mesh.bottom_radius = 0.42
	crown_mesh.height = width
	crown.mesh = crown_mesh
	crown.rotation.z = deg_to_rad(90.0)
	crown.position.y = 3.1
	crown.material_override = _material(color)
	arch.add_child(crown)
	parent.add_child(arch)

func _build_open_terrain(world_length: float, world_width: float, terrain_style: String) -> void:
	var palette := _palette_for(terrain_style)
	var tree_count := int(clampf(round(world_length / 7.0), 10.0, 18.0))
	var edge := world_width * 0.5 - 3.0
	for index in range(tree_count):
		var z := -6.0 - float(index) * (world_length - 6.0) / float(tree_count - 1)
		var left_x := -edge + sin(float(index) * 1.7) * 1.4
		var right_x := edge + cos(float(index) * 1.3) * 1.4
		_add_tree(Vector3(left_x, 0.0, z), 0.85 + float(index % 3) * 0.18, palette.foliage)
		_add_tree(Vector3(right_x, 0.0, z + 1.5), 0.80 + float((index + 1) % 3) * 0.20, palette.foliage)
		if index % 3 == 1:
			course.add_child(_make_platform(Vector3(left_x + 2.0, 0.35, z - 2.0), Vector3(2.2, 1.5, 2.4), palette.rock))
			course.add_child(_make_platform(Vector3(right_x - 2.2, 0.55, z + 3.0), Vector3(2.6, 1.9, 2.6), palette.rock))

func _palette_for(style: String) -> Dictionary:
	match style:
		"moss":
			return {"basin": Color("#324b32"), "start": Color("#426740"), "safe": Color("#527a48"), "expert": Color("#6b9b58"), "ramp": Color("#638951"), "finale": Color("#8ab85f"), "foliage": Color("#55844d"), "rock": Color("#425e3c"), "root": Color("#3b442d"), "summit": Color("#7fa65b"), "sign": Color("#c9ec8c")}
		"canopy":
			return {"basin": Color("#243e3b"), "start": Color("#365b52"), "safe": Color("#4d7463"), "expert": Color("#5d9d83"), "ramp": Color("#5f8870"), "finale": Color("#8bca9b"), "foliage": Color("#4f7961"), "rock": Color("#39574d"), "root": Color("#354536"), "summit": Color("#6d9e77"), "sign": Color("#b5f0c5")}
		"root":
			return {"basin": Color("#3d382d"), "start": Color("#5d513b"), "safe": Color("#756548"), "expert": Color("#937a50"), "ramp": Color("#806b49"), "finale": Color("#c6a663"), "foliage": Color("#576342"), "rock": Color("#574c38"), "root": Color("#443722"), "summit": Color("#9f8553"), "sign": Color("#f0d28a")}
		"sap":
			return {"basin": Color("#303a4c"), "start": Color("#45597a"), "safe": Color("#5b718f"), "expert": Color("#7999bd"), "ramp": Color("#6683a3"), "finale": Color("#a2c8dd"), "foliage": Color("#516f7d"), "rock": Color("#405066"), "root": Color("#384035"), "summit": Color("#7fa7ba"), "sign": Color("#cae9ff")}
		"wild":
			return {"basin": Color("#3d303a"), "start": Color("#65435e"), "safe": Color("#7d5a73"), "expert": Color("#b17896"), "ramp": Color("#946b83"), "finale": Color("#df9db8"), "foliage": Color("#6e5668"), "rock": Color("#574152"), "root": Color("#3d3035"), "summit": Color("#ad7190"), "sign": Color("#ffd0e2")}
		"summit":
			return {"basin": Color("#343a31"), "start": Color("#4d6040"), "safe": Color("#657c4f"), "expert": Color("#94b963"), "ramp": Color("#77955a"), "finale": Color("#d0e679"), "foliage": Color("#648450"), "rock": Color("#4a5a3d"), "root": Color("#35402d"), "summit": Color("#a8c866"), "sign": Color("#f1ffb5")}
		_:
			return {"basin": Color("#2d4433"), "start": Color("#39553e"), "safe": Color("#496a48"), "expert": Color("#628253"), "ramp": Color("#5c7b51"), "finale": Color("#8aaa63"), "foliage": Color("#496848"), "rock": Color("#3b563d"), "root": Color("#33442e"), "summit": Color("#5b7749"), "sign": Color("#d8f2ad")}

func _make_ramp_between(start_surface: Vector3, end_surface: Vector3, width: float, color: Color) -> StaticBody3D:
	traversal_ramp_count += 1
	var body := StaticBody3D.new()
	body.name = "TraversalRamp"
	body.set_meta("traversal_ramp", true)
	var path := end_surface - start_surface
	var length := path.length()
	var ramp_center := (start_surface + end_surface) * 0.5 - Vector3(0.0, 0.28, 0.0)
	body.look_at_from_position(ramp_center, end_surface, Vector3.UP)
	var visual := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(width, 0.56, length)
	visual.mesh = box
	visual.material_override = _material(color)
	body.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box.size
	collision.shape = shape
	body.add_child(collision)
	return body

func _add_climbable_trunk(position: Vector3, height: float, radius: float, parent: Node3D = course) -> void:
	climbable_trunk_count += 1
	var body := StaticBody3D.new()
	body.name = "ClimbableTrunk"
	body.set_meta("climbable_trunk", true)
	body.position = position
	var visual := MeshInstance3D.new()
	var trunk := CylinderMesh.new()
	trunk.top_radius = radius * 0.78
	trunk.bottom_radius = radius
	trunk.height = height
	visual.mesh = trunk
	visual.position.y = height * 0.5
	visual.material_override = _material(Color("#33442e"))
	body.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = radius
	shape.height = height
	collision.shape = shape
	collision.position.y = height * 0.5
	body.add_child(collision)
	parent.add_child(body)

func _make_platform(position: Vector3, size: Vector3, color: Color) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = position
	var visual := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	visual.mesh = box
	visual.material_override = _material(color)
	body.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	return body

func _make_collectible(position: Vector3) -> CourseTrigger:
	var item := _trigger(CourseTrigger.TriggerType.COLLECTIBLE, Vector3(1.0, 1.4, 1.0), null)
	item.position = position
	var visual := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.32
	sphere.height = 0.64
	visual.mesh = sphere
	visual.material_override = _material(Color("#f2d98c"), true)
	item.add_child(visual)
	return item

func _make_boost(position: Vector3, direction: Vector3) -> CourseTrigger:
	var pad := _trigger(CourseTrigger.TriggerType.BOOST, Vector3(3.4, 0.7, 1.4), direction)
	pad.position = position
	var visual := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(3.2, 0.14, 1.25)
	visual.mesh = box
	visual.material_override = _material(Color("#78b78b"), true)
	pad.add_child(visual)
	return pad

func _make_launch(position: Vector3) -> CourseTrigger:
	var pad := _trigger(CourseTrigger.TriggerType.LAUNCH, Vector3(2.6, 0.8, 2.6), 13.5)
	pad.position = position
	var visual := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 0.9
	cylinder.bottom_radius = 1.2
	cylinder.height = 0.22
	visual.mesh = cylinder
	visual.material_override = _material(Color("#a6d47b"), true)
	pad.add_child(visual)
	return pad

func _make_combo_gap(position: Vector3, gap_id: String, points: int) -> CourseTrigger:
	combo_gap_count += 1
	var gap := _trigger(CourseTrigger.TriggerType.COMBO_GAP, Vector3(4.4, 3.6, 2.0), {"id": gap_id, "points": points})
	gap.name = "ComboGap"
	gap.position = position
	gap.set_meta("gap_id", gap_id)
	gap.set_meta("style_points", points)
	var visual := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 1.08
	ring.outer_radius = 1.24
	visual.mesh = ring
	visual.rotation.x = deg_to_rad(90.0)
	visual.material_override = _material(Color("#f1d477"), true)
	gap.add_child(visual)
	var label := Label3D.new()
	label.text = "GAP +%d" % points
	label.font = ui_theme.default_font
	label.font_size = 24
	label.outline_size = 4
	label.modulate = Color("#f7e7a2")
	label.position = Vector3(0.0, 1.55, 0.0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = 0.008
	gap.add_child(label)
	return gap

func _make_recharge_gate(position: Vector3, tool: String, gate_id: String) -> CourseTrigger:
	var gate := _trigger(CourseTrigger.TriggerType.RECHARGE, Vector3(3.0, 3.4, 1.5), {"tool": tool, "id": gate_id})
	gate.name = "RechargeGate"
	gate.position = position
	gate.set_meta("recharge_gate", tool)
	var visual := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.86
	ring.outer_radius = 1.02
	visual.mesh = ring
	visual.rotation.x = deg_to_rad(90.0)
	visual.material_override = _material(Color("#8be6ff"), true)
	gate.add_child(visual)
	var label := Label3D.new()
	label.text = "DASH REFILL" if tool == "dash" else "JUMP REFILL"
	label.font = ui_theme.default_font
	label.font_size = 22
	label.outline_size = 4
	label.modulate = Color("#d8f6ff")
	label.position = Vector3(0.0, 1.45, 0.0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = 0.008
	gate.add_child(label)
	recharge_gate_count += 1
	return gate

func _make_reset_pad(position: Vector3, spawn: Vector3, station: String, restart_session := false) -> CourseTrigger:
	var pad := _trigger(CourseTrigger.TriggerType.RESET, Vector3(3.2, 1.2, 3.2), {"spawn": spawn, "station": station, "restart": restart_session})
	pad.name = "CentralResetPad" if restart_session else "StationResetPad"
	pad.position = position
	pad.set_meta("station", station)
	var visual := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 1.15
	cylinder.bottom_radius = 1.35
	cylinder.height = 0.18
	visual.mesh = cylinder
	visual.material_override = _material(Color("#7da7d8"), true)
	pad.add_child(visual)
	var label := Label3D.new()
	label.text = "RESET RUN" if restart_session else "RESET HERE"
	label.font = ui_theme.default_font
	label.font_size = 22
	label.outline_size = 4
	label.modulate = Color("#d8edff")
	label.position = Vector3(0.0, 1.1, 0.0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = 0.008
	pad.add_child(label)
	return pad

func _make_checkpoint(position: Vector3, checkpoint_id: String) -> CourseTrigger:
	var checkpoint := _trigger(CourseTrigger.TriggerType.CHECKPOINT, Vector3(2.8, 3.0, 1.4), {"id": checkpoint_id})
	checkpoint.name = "Checkpoint_" + checkpoint_id
	checkpoint.position = position
	checkpoint.set_meta("checkpoint_id", checkpoint_id)
	var ring := MeshInstance3D.new()
	var ring_mesh := TorusMesh.new()
	ring_mesh.inner_radius = 0.78
	ring_mesh.outer_radius = 0.96
	ring.mesh = ring_mesh
	ring.rotation.x = deg_to_rad(90.0)
	ring.material_override = _material(Color("#d1a4ff"), true)
	checkpoint.add_child(ring)
	var label := Label3D.new()
	label.text = "CHECKPOINT"
	label.font = ui_theme.default_font
	label.font_size = 20
	label.outline_size = 3
	label.modulate = Color("#ecdfff")
	label.position = Vector3(0.0, 1.3, 0.0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = 0.008
	checkpoint.add_child(label)
	return checkpoint

func _trigger(type: CourseTrigger.TriggerType, size: Vector3, payload: Variant) -> CourseTrigger:
	trigger_count += 1
	var trigger := CourseTrigger.new()
	trigger.trigger_type = type
	trigger.payload = payload
	trigger.callback = _on_trigger
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	trigger.add_child(collision)
	return trigger

func _on_trigger(type: CourseTrigger.TriggerType, payload: Variant) -> void:
	match type:
		CourseTrigger.TriggerType.COLLECTIBLE:
			collected_in_level += 1
			RunData.add_collectible()
			_present_style_result(RunData.add_style_action("collectible"))
			Audio.play_sfx("pickup")
			last_sandbox_event = "COLLECTIBLE"
			_refresh_hud()
		CourseTrigger.TriggerType.BOOST:
			player.apply_boost(payload)
			Audio.play_sfx("boost")
			last_sandbox_event = "BOOST PAD"
		CourseTrigger.TriggerType.LAUNCH:
			player.launch(float(payload))
			Audio.play_sfx("launch")
			last_sandbox_event = "LAUNCH PAD"
		CourseTrigger.TriggerType.COMBO_GAP:
			var gap: Dictionary = payload if payload is Dictionary else {}
			_present_style_result(RunData.add_style_action("gap", int(gap.get("points", 300)), str(gap.get("id", ""))))
			Audio.play_sfx("pickup")
			last_sandbox_event = "STYLE GAP " + str(gap.get("id", ""))
		CourseTrigger.TriggerType.RESET:
			var reset: Dictionary = payload if payload is Dictionary else {}
			if bool(reset.get("restart", false)):
				last_sandbox_event = "CENTRAL RESET"
				call_deferred("_restart_level")
			else:
				_reset_to_station(reset)
		CourseTrigger.TriggerType.RECHARGE:
			var recharge: Dictionary = payload if payload is Dictionary else {}
			player.recharge_air_tool(str(recharge.get("tool", "dash")))
			Audio.play_sfx("pickup")
			last_sandbox_event = "REFILL " + str(recharge.get("tool", "dash")).to_upper()
		CourseTrigger.TriggerType.CHECKPOINT:
			var checkpoint: Dictionary = payload if payload is Dictionary else {}
			var checkpoint_id := str(checkpoint.get("id", "checkpoint"))
			if creative_session:
				var reached: Array = creative_playtest.get("checkpoints", [])
				if not reached.has(checkpoint_id):
					reached.append(checkpoint_id)
					var checkpoint_times: Dictionary = creative_playtest.get("checkpoint_times", {})
					checkpoint_times[checkpoint_id] = RunData.elapsed
					creative_playtest["checkpoint_times"] = checkpoint_times
				creative_playtest["checkpoints"] = reached
				_record_creative_event("checkpoint", checkpoint_id)
			last_sandbox_event = "CHECKPOINT " + checkpoint_id.to_upper()
	_record_creative_event("trigger", str(type))

func _on_traversal_action(action: String, override_points: int) -> void:
	last_sandbox_event = action.replace("_", " ").to_upper()
	if bool(current_level.get("procedural", false)): run_balance_telemetry.record_action(action)
	_record_creative_event("traversal", action)
	_present_style_result(RunData.add_style_action(action, override_points))

func _attempt_wildlife_traversal_hits() -> void:
	if player == null: return
	var context: Dictionary = player.traversal_melee_context()
	if context.is_empty(): return
	for node: Node in get_tree().get_nodes_in_group("wildlife"):
		var animal := node as Node3D
		if animal == null or not animal.has_method("register_traversal_hit"): continue
		var result: Dictionary = TRAVERSAL_MELEE.hit(str(context.state), float(context.speed), context.origin, animal.global_position)
		var impulse := SLIDE_IMPACT.resolve(float(context.speed), context.direction) if str(context.state) == "slide" else SLAM_IMPACT.resolve(float(context.speed), context.origin, animal.global_position) if str(context.state) == "slam" else GRAPPLE_IMPACT.resolve(float(context.speed), context.direction)
		if bool(result.hit) and bool(animal.call("register_traversal_hit", str(context.state), impulse)):
			last_sandbox_event = "WILDLIFE " + str(context.state).to_upper()
			_show_encounter_feedback(WILDLIFE_FEEDBACK.escape(str(context.state)))

func _show_encounter_feedback(feedback: Dictionary) -> void:
	if briefing_label == null: return
	briefing_label.text = str(feedback.text)
	briefing_label.add_theme_color_override("font_color", feedback.color)
	briefing_label.modulate.a = 1.0
	var tween := create_tween()
	tween.tween_property(briefing_label, "modulate:a", 0.0, 0.35).set_delay(1.4)

func _on_combo_landed() -> void:
	RunData.style_land()

func _reset_to_station(reset: Dictionary) -> void:
	if player == null:
		return
	var spawn: Variant = reset.get("spawn", player_spawn)
	if not spawn is Vector3:
		return
	player.reset_for_bail(spawn)
	current_station = str(reset.get("station", current_station))
	if creative_session and not creative_playtest.is_empty():
		creative_playtest["resets"] = int(creative_playtest.get("resets", 0)) + 1
		_record_creative_event("reset", current_station)
	last_sandbox_event = "RESET " + current_station.to_upper()

func _refresh_sandbox_context() -> void:
	if player == null or sandbox_stations.is_empty():
		return
	var nearest_name := current_station
	var nearest_distance := INF
	for station in sandbox_stations:
		var center: Variant = station.get("center", Vector3.ZERO)
		if not center is Vector3:
			continue
		var distance := player.global_position.distance_to(center)
		if distance < nearest_distance:
			nearest_distance = distance
			nearest_name = str(station.get("name", nearest_name))
	current_station = nearest_name

func _refresh_debug_hud() -> void:
	if debug_panel == null or not debug_visible or not hud.visible or player == null:
		return
	var planar_speed := Vector2(player.velocity.x, player.velocity.z).length()
	var anchor_text := "NONE"
	if player.grapple_anchor and is_instance_valid(player.grapple_anchor):
		anchor_text = player.grapple_anchor.name + " @ " + _vector_text(player.grapple_anchor.global_position)
	var flags: Array[String] = []
	if player.is_on_floor(): flags.append("GROUND")
	if player.is_sprinting: flags.append("SPRINT")
	if player.is_sliding: flags.append("SLIDE")
	if player.is_wall_running: flags.append("WALL RUN")
	if player.is_wall_sliding: flags.append("WALL SLIDE")
	if player.is_slamming: flags.append("SLAM")
	if player.is_gliding: flags.append("GLIDE")
	if player.is_grappling: flags.append("TETHER")
	if flags.is_empty(): flags.append("AIR")
	var active_objects := int(Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS))
	var collision_pairs := int(Performance.get_monitor(Performance.PHYSICS_3D_COLLISION_PAIRS))
	var islands := int(Performance.get_monitor(Performance.PHYSICS_3D_ISLAND_COUNT))
	var lightmap := course.get_node_or_null("BakedLightmap") as LightmapGI
	var lightmap_state := "BAKED" if lightmap and lightmap.light_data else "BAKE REQUIRED"
	var chunk_text := ""
	var streaming_text := ""
	if world_streamer:
		chunk_text = "\nCHUNKS %d  REGION %s\n%s" % [world_streamer.chunks.size(), str(current_region.get("name", "Unknown")), WORLD_DIAGNOSTICS.summary(world_streamer.sample_at(player.global_position))]
		var diagnostics: Dictionary = world_streamer.streaming_diagnostics()
		var refresh: Dictionary = diagnostics.get("refresh", {})
		var telemetry: Dictionary = diagnostics.get("telemetry", {})
		var memory: Dictionary = diagnostics.get("memory", {})
		var recent: Array = telemetry.get("recent_hitches", [])
		var last: Dictionary = recent.back() as Dictionary if not recent.is_empty() else {}
		var last_phases: Dictionary = last.get("phases", {})
		streaming_text = "\nSTREAM %.1fms  MAX %.1fms  HITCH %d  LAST %.1fms\nBUILD A %.1f F %.1f D %.1f C %.1f  PEND %d\nLAST A %.1f F %.1f D %.1f C %.1f\nMEM %.1fMB  PAYLOAD %.1fMB" % [float(refresh.get("refresh_ms", 0.0)), float(telemetry.get("max_refresh_ms", 0.0)), int(telemetry.get("hitches", 0)), float(last.get("refresh_ms", 0.0)), float(refresh.get("active_chunk_build_ms", 0.0)), float(refresh.get("far_chunk_build_ms", 0.0)), float(refresh.get("feature_build_ms", 0.0)), float(refresh.get("collision_lod_ms", 0.0)), int(refresh.get("pending_features", 0)), float(last_phases.get("active_chunk_build_ms", 0.0)), float(last_phases.get("far_chunk_build_ms", 0.0)), float(last_phases.get("feature_build_ms", 0.0)), float(last_phases.get("collision_lod_ms", 0.0)), float(int(memory.get("static_memory_bytes", 0))) / 1048576.0, float(int(memory.get("minimum_payload_bytes", 0))) / 1048576.0]
	var balance_text := ""
	if bool(current_level.get("procedural", false)):
		var balance: Dictionary = run_balance_telemetry.summary()
		var action_total := 0
		for count: int in (balance.actions as Dictionary).values(): action_total += count
		balance_text = "\nBAL SPD %.2f  PRESS %.2f  STYLE %.2f  ACT %d" % [float(balance.minimum_speed_multiplier), float(balance.maximum_recovery_pressure), float(balance.average_style_movement_multiplier), action_total]
	debug_label.text = "DEBUG  F3 TO HIDE\nFPS %d  FRAME %.2fms  PHYS %dHz\nPOS %s  VEL %s  SPD %.2f\nSTATE %s\nDASH %s  DOUBLE %s  GRAPPLE %s\nANCHOR %s\nMOM %.1f/%.1f  WALL %.2fs\nSTATION %s  LIGHTMAP %s\nPHYS ACTIVE %d  PAIRS %d  ISLANDS %d\nNODES %d  TRIGGERS %d  RAMPS %d  GAPS %d\nREFILLS %d%s%s%s\nEVENT %s" % [Engine.get_frames_per_second(), frame_time * 1000.0, Engine.physics_ticks_per_second, _vector_text(player.global_position), _vector_text(player.velocity), planar_speed, " / ".join(flags), "READY" if player.can_dash else "USED", "READY" if player.can_double_jump else "USED", "ON" if player.is_grappling else "OFF", anchor_text, planar_speed, SpeedPlayer.AIR_SOFT_SPEED_CAP, player.wall_run_timer, current_station, lightmap_state, active_objects, collision_pairs, islands, get_tree().get_node_count(), trigger_count, traversal_ramp_count, combo_gap_count, recharge_gate_count, chunk_text, streaming_text, balance_text, last_sandbox_event]

func _vector_text(value: Vector3) -> String:
	return "(%.1f, %.1f, %.1f)" % [value.x, value.y, value.z]

func _present_style_result(result: Dictionary) -> void:
	if style_award_feed == null:
		return
	var banked_now := int(result.get("banked_now", 0))
	if banked_now > 0:
		style_award_feed.push_bank(banked_now)
		_pulse_style_meter("major", false)
		Audio.play_style_sfx("major")
	var lost_now := int(result.get("lost_now", 0))
	if lost_now > 0:
		style_award_feed.push_bail(lost_now)
		_pulse_style_meter("minor", false)
	if not bool(result.get("awarded", false)):
		return
	var award: Dictionary = result.get("award", {})
	if award.is_empty():
		return
	var severity := str(award.get("severity", "minor"))
	var rank_up := bool(award.get("rank_up", false))
	style_award_feed.push_award(award)
	_pulse_style_meter(severity, rank_up)
	if player:
		player.apply_style_feedback("peak" if rank_up else severity)
	_flash_style("peak" if rank_up else severity)
	if int(award.get("points", 0)) >= 120 or str(award.get("action", "")) == "gap" or rank_up:
		Audio.play_style_sfx(severity, rank_up)

func _pulse_style_meter(severity: String, rank_up: bool) -> void:
	if style_meter == null:
		return
	if style_meter_tween:
		style_meter_tween.kill()
	var amount := 1.12 if rank_up or severity == "peak" else (1.07 if severity == "major" else 1.035)
	style_meter.pivot_offset = Vector2(155.0, 7.0)
	style_meter_tween = create_tween()
	style_meter_tween.tween_property(style_meter, "scale", Vector2(amount, amount), 0.06).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	style_meter_tween.tween_property(style_meter, "scale", Vector2.ONE, 0.14).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

func _flash_style(severity: String) -> void:
	if style_flash == null or Settings.reduce_screen_effects or not RunData.running:
		return
	if style_flash_tween:
		style_flash_tween.kill()
	var color := Color("#b9f6df")
	var alpha := 0.035
	var duration := 0.08
	match severity:
		"peak":
			color = Color("#f7e7a2")
			alpha = 0.10
			duration = 0.14
		"major":
			color = Color("#f1d477")
			alpha = 0.065
			duration = 0.11
	color.a = alpha
	style_flash.color = color
	style_flash.visible = true
	style_flash_tween = create_tween()
	style_flash_tween.tween_property(style_flash, "color:a", 0.0, duration).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	style_flash_tween.tween_callback(func(): style_flash.visible = false)

func _clear_style_flash() -> void:
	if style_flash_tween:
		style_flash_tween.kill()
	if style_flash:
		style_flash.color.a = 0.0
		style_flash.visible = false

func _add_tree(position: Vector3, scale_factor: float, foliage_color: Color = Color("#496848")) -> void:
	var tree := Node3D.new()
	tree.position = position
	var trunk := MeshInstance3D.new()
	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.top_radius = 0.16 * scale_factor
	trunk_mesh.bottom_radius = 0.25 * scale_factor
	trunk_mesh.height = 3.0 * scale_factor
	trunk.mesh = trunk_mesh
	trunk.position.y = 1.5 * scale_factor
	trunk.material_override = _material(Color("#293b28"))
	tree.add_child(trunk)
	for branch in range(3):
		var crown := MeshInstance3D.new()
		var crown_mesh := CylinderMesh.new()
		crown_mesh.top_radius = 0.0
		crown_mesh.bottom_radius = (1.15 - branch * 0.18) * scale_factor
		crown_mesh.height = 1.9 * scale_factor
		crown.mesh = crown_mesh
		crown.position.y = (3.2 + branch * 0.75) * scale_factor
		crown.material_override = _foliage_material(foliage_color, 0.055 + float(branch) * 0.018)
		tree.add_child(crown)
	course.add_child(tree)

func _material(color: Color, emissive := false) -> Material:
	if emissive:
		var pulse := ShaderMaterial.new()
		pulse.shader = pulse_shader
		pulse.set_shader_parameter("base_color", color)
		pulse.set_shader_parameter("pulse_speed", 2.4)
		return pulse
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.88
	return material

func _foliage_material(color: Color, sway_strength: float) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = foliage_shader
	material.set_shader_parameter("base_color", color)
	material.set_shader_parameter("sway_strength", sway_strength)
	return material

func _make_foliage_shader() -> Shader:
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode cull_back, diffuse_burley;
uniform vec4 base_color : source_color = vec4(0.30, 0.45, 0.29, 1.0);
uniform float sway_strength = 0.08;
varying float wind_light;
void vertex() {
	vec3 world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float wave = sin(TIME * 1.7 + world_position.x * 0.73 + world_position.z * 0.61);
	float height_factor = clamp(VERTEX.y + 0.25, 0.0, 1.0);
	VERTEX.x += wave * sway_strength * height_factor;
	VERTEX.z += cos(TIME * 1.3 + world_position.z * 0.92) * sway_strength * 0.45 * height_factor;
	wind_light = wave;
}
void fragment() {
	ALBEDO = base_color.rgb * (0.93 + wind_light * 0.07);
	ROUGHNESS = 0.84;
}
"""
	return shader

func _make_pulse_shader() -> Shader:
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode unshaded, cull_back;
uniform vec4 base_color : source_color = vec4(0.50, 0.80, 0.55, 1.0);
uniform float pulse_speed = 2.4;
void fragment() {
	float pulse = 0.72 + 0.28 * sin(TIME * pulse_speed);
	ALBEDO = base_color.rgb * (0.72 + pulse * 0.28);
	EMISSION = base_color.rgb * pulse * 1.8;
	ALPHA = base_color.a;
}
"""
	return shader

func _make_ui_theme() -> Theme:
	var font := load("res://assets/fonts/BigBlueTerm437NerdFont-Regular.ttf") as FontFile
	assert(font != null, "BigBlueTerm font missing")
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	font.allow_system_fallback = false
	var theme := Theme.new()
	theme.default_font = font
	theme.default_font_size = 16
	return theme

func _make_pixel_filter_material() -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = """
shader_type canvas_item;
uniform sampler2D screen_texture : hint_screen_texture, repeat_disable, filter_nearest;
uniform float pixel_size = 4.0;
uniform float palette_steps = 16.0;
void fragment() {
	vec2 cell = SCREEN_PIXEL_SIZE * pixel_size;
	vec2 sample_uv = (floor(SCREEN_UV / cell) + vec2(0.5)) * cell;
	vec4 color = texture(screen_texture, sample_uv);
	color.rgb = floor(color.rgb * palette_steps + 0.5) / palette_steps;
	COLOR = color;
}
"""
	var material := ShaderMaterial.new()
	material.shader = shader
	return material

func _apply_pixel_filter(mode: int) -> void:
	if not display_filter:
		return
	display_filter.visible = mode != Settings.PIXEL_FILTER_OFF
	if display_filter.visible:
		(display_filter.material as ShaderMaterial).set_shader_parameter("pixel_size", float(mode))
		(display_filter.material as ShaderMaterial).set_shader_parameter("palette_steps", 16.0)

func _add_forest_motes() -> void:
	var particles := GPUParticles3D.new()
	particles.name = "ForestMotes"
	particles.position = Vector3(0.0, 3.0, -52.0)
	particles.amount = 110
	particles.lifetime = 12.0
	particles.preprocess = 12.0
	particles.randomness = 0.35
	particles.local_coords = false
	particles.visibility_aabb = AABB(Vector3(-24.0, -4.0, -96.0), Vector3(48.0, 16.0, 192.0))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(16.0, 4.0, 68.0)
	process.direction = Vector3(0.0, 1.0, 0.0)
	process.spread = 180.0
	process.gravity = Vector3(0.0, 0.05, 0.0)
	process.initial_velocity_min = 0.08
	process.initial_velocity_max = 0.30
	process.scale_min = 0.035
	process.scale_max = 0.080
	process.color = Color("d7edb0b8")
	particles.process_material = process
	particles.draw_pass_1 = _particle_quad(0.09, Color("d7edb0b8"))
	course.add_child(particles)

func _particle_quad(size: float, color: Color) -> QuadMesh:
	var quad := QuadMesh.new()
	quad.size = Vector2(size, size)
	var material := StandardMaterial3D.new()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = color
	material.emission_energy_multiplier = 1.4
	quad.material = material
	return quad

func _restart_level() -> void:
	if current_level.is_empty() or not RunData.running:
		return
	start_level(current_level.id)

func _bail_to_start() -> void:
	if current_level.is_empty() or not RunData.running or player == null:
		return
	_present_style_result(RunData.bail_style())
	player.reset_for_bail(player_spawn)
	Audio.play_sfx("dash")

func _forecast_text() -> String:
	if world_streamer == null or player == null: return "FORECAST --"
	var cell_x := floori(player.global_position.x / 48.0)
	var cell_z := floori(player.global_position.z / 48.0)
	var key := "%d:%d:%d" % [WORLD_WEATHER.bucket_for(weather_clock), cell_x, cell_z]
	if key != weather_forecast_key:
		weather_forecast_key = key
		var forward := -player.global_transform.basis.z
		forward.y = 0.0
		if forward.length() < 0.1: forward = Vector3.FORWARD
		var side := Vector3(-forward.z, 0.0, forward.x)
		var routes: Array = []
		for route: Dictionary in [{"route":"FWD","offset":forward.normalized()*96.0},{"route":"L","offset":(forward-side).normalized()*72.0},{"route":"R","offset":(forward+side).normalized()*72.0}]:
			var point: Vector3 = player.global_position + route.offset
			var sample: Dictionary = world_streamer.sample_at(point)
			routes.append({"route":route.route,"distance":float(route.offset.length()),"cell":{"x":point.x,"y":point.z,"temperature":sample.temperature,"rainfall":sample.rainfall,"water":sample.water,"slope":sample.get("slope",0.0)}})
		weather_forecast = WORLD_WEATHER.forecast({"seed":world_streamer.generator.seed}, routes, {"clock":weather_clock})
	var parts: Array[String] = []
	for forecast: Dictionary in weather_forecast:
		parts.append("%s %s %02d" % [str(forecast.route), WORLD_WEATHER.label(forecast.weather).to_upper(), int(float(forecast.risk)*100.0)])
	return "FORECAST " + " / ".join(parts)

func _refresh_hud() -> void:
	if current_level.is_empty():
		return
	timer_label.text = _time_text(RunData.elapsed)
	var total := _collectible_count(current_level)
	collect_label.text = "PICKUPS %d/%d" % [RunData.collected, total]
	forecast_label.text = _forecast_text() if bool(current_level.get("procedural", false)) else "FORECAST --"
	var style := RunData.style_snapshot()
	var total_style := int(style.get("banked", 0)) + int(style.get("active", 0))
	var tier := str(style.get("tier", "QUIET"))
	var tier_color := _style_tier_color(tier)
	style_score_label.text = "STYLE %06d  %s" % [total_style, tier]
	style_score_label.add_theme_color_override("font_color", tier_color)
	style_meter_fill.bg_color = tier_color
	style_meter.value = clampf(float(style.get("meter_ratio", 0.0)) * 100.0, 0.0, 100.0)
	var actions := int(style.get("actions", 0))
	if actions > 0:
		combo_label.text = "COMBO %d  x%d  +%d" % [actions, int(style.get("multiplier", 1)), int(style.get("active", 0))]
		style_event_label.text = "MVT x%.2f  LINK %.2fs  %s" % [float(style.get("movement_multiplier", 1.0)), StyleRun.LINK_WINDOW, str(style.get("last_action", "")).replace("_", " ").to_upper()]
	elif int(style.get("last_lost", 0)) > 0:
		combo_label.text = "BAIL -%d" % int(style.get("last_lost", 0))
		style_event_label.text = "BANKED STYLE WILL FADE"
	elif int(style.get("last_banked", 0)) > 0:
		combo_label.text = "BANKED +%d" % int(style.get("last_banked", 0))
		style_event_label.text = "START A NEW CHAIN"
	elif int(style.get("last_decay", 0)) > 0:
		combo_label.text = "STYLE DECAY -%d" % int(style.get("last_decay", 0))
		style_event_label.text = "LINK ACTIONS TO HOLD YOUR METER"
	else:
		combo_label.text = "COMBO --"
		style_event_label.text = "CHAIN MOVEMENT TO BANK STYLE"

func _style_tier_color(tier: String) -> Color:
	match tier:
		"LEGEND": return Color("#f7e7a2")
		"WILD": return Color("#f1d477")
		"CHARGED": return Color("#e7c67b")
		"FLOW": return Color("#b9f6df")
		_: return Color("#9db197")

func _refresh_grapple_reticle() -> void:
	if grapple_reticle == null or player == null or not player.movement_enabled or player.is_grappling:
		if grapple_reticle:
			grapple_reticle.clear_target()
		return
	if Vector2(player.velocity.x, player.velocity.z).length() < 2.5:
		grapple_reticle.clear_target()
		return
	var anchor := player.grapple_candidate()
	if anchor == null or player.camera.is_position_behind(anchor.global_position):
		grapple_reticle.clear_target()
		return
	var screen_position := player.camera.unproject_position(anchor.global_position)
	var viewport_size := get_viewport().get_visible_rect().size
	if screen_position.x < -64.0 or screen_position.y < -64.0 or screen_position.x > viewport_size.x + 64.0 or screen_position.y > viewport_size.y + 64.0:
		grapple_reticle.clear_target()
		return
	grapple_reticle.track(anchor, screen_position)

func _collectible_count(level: Dictionary) -> int:
	return total_collectibles_in_level

func show_pause() -> void:
	if not RunData.running:
		return
	grapple_reticle.clear_target()
	_clear_style_flash()
	style_award_feed.clear_feed()
	debug_panel.visible = false
	menu_mode = "pause"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_clear_menu()
	var panel := _center_panel(Vector2(430.0, 420.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Paused", 34, Color("#edf3d5")))
	var resume := _button("Resume", 19)
	resume.pressed.connect(resume_run)
	box.add_child(resume)
	if creative_session:
		var creative := _button("Return to creative", 19)
		creative.pressed.connect(func():
			get_tree().paused = false
			_return_to_creative_editor()
		)
		box.add_child(creative)
	var restart := _button("Reset session", 19)
	restart.pressed.connect(func():
		get_tree().paused = false
		_restart_level()
	)
	box.add_child(restart)
	var settings := _button("Settings", 19)
	settings.pressed.connect(show_settings.bind("pause"))
	box.add_child(settings)
	if bool(current_level.get("procedural", false)):
		var journal := _button("Survey journal", 19)
		journal.pressed.connect(show_world_journal.bind("pause"))
		box.add_child(journal)
	var levels := _button("Sandbox select", 19)
	levels.pressed.connect(show_level_select)
	box.add_child(levels)
	var quit := _button("Quit game", 19)
	quit.name = "QuitGame"
	quit.pressed.connect(func(): get_tree().quit())
	box.add_child(quit)

func resume_run() -> void:
	get_tree().paused = false
	_clear_menu()
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	debug_panel.visible = debug_visible

func show_settings(back_mode: String) -> void:
	menu_mode = "settings"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_clear_menu()
	var panel := _center_panel(Vector2(800.0, 660.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	box.add_child(_label("Settings", 34, Color("#edf3d5")))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0.0, 550.0)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(scroll)
	var content := VBoxContainer.new()
	content.custom_minimum_size = Vector2(720.0, 0.0)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 8)
	scroll.add_child(content)
	content.add_child(_label("Mouse sensitivity", 16, Color("#d4e0c9")))
	var sensitivity := HSlider.new()
	sensitivity.custom_minimum_size.x = 690.0
	sensitivity.min_value = 0.0007
	sensitivity.max_value = 0.006
	sensitivity.step = 0.0001
	sensitivity.value = Settings.mouse_sensitivity
	sensitivity.value_changed.connect(func(value: float):
		Settings.mouse_sensitivity = value
		Settings.save_settings()
	)
	content.add_child(sensitivity)
	var invert := CheckBox.new()
	invert.text = "Invert vertical look"
	invert.button_pressed = Settings.invert_y
	invert.toggled.connect(func(value: bool):
		Settings.invert_y = value
		Settings.save_settings()
	)
	content.add_child(invert)
	var slide_mode := CheckBox.new()
	slide_mode.text = "Toggle slide (off = hold)"
	slide_mode.button_pressed = Settings.slide_toggle
	slide_mode.toggled.connect(func(value: bool):
		Settings.slide_toggle = value
		Settings.save_settings()
	)
	content.add_child(slide_mode)
	var tether_mode := CheckBox.new()
	tether_mode.text = "Toggle tether (off = hold)"
	tether_mode.button_pressed = Settings.tether_toggle
	tether_mode.toggled.connect(func(value: bool):
		Settings.tether_toggle = value
		Settings.save_settings()
	)
	content.add_child(tether_mode)
	var wildlife_mode := CheckBox.new()
	wildlife_mode.text = "Wildlife encounters"
	wildlife_mode.button_pressed = Settings.wildlife_encounters
	wildlife_mode.toggled.connect(func(value: bool):
		Settings.wildlife_encounters = value
		Settings.save_settings()
	)
	content.add_child(wildlife_mode)
	var reduced_effects := CheckBox.new()
	reduced_effects.text = "Reduce screen effects (keeps score UI)"
	reduced_effects.button_pressed = Settings.reduce_screen_effects
	reduced_effects.toggled.connect(func(value: bool):
		Settings.reduce_screen_effects = value
		Settings.save_settings()
	)
	content.add_child(reduced_effects)
	content.add_child(_label("Pixel filter", 16, Color("#d4e0c9")))
	var pixel_filter := OptionButton.new()
	pixel_filter.add_item("Off", Settings.PIXEL_FILTER_OFF)
	pixel_filter.add_item("2x", Settings.PIXEL_FILTER_2X)
	pixel_filter.add_item("4x", Settings.PIXEL_FILTER_4X)
	match Settings.pixel_filter_mode:
		Settings.PIXEL_FILTER_2X:
			pixel_filter.select(1)
		Settings.PIXEL_FILTER_4X:
			pixel_filter.select(2)
		_:
			pixel_filter.select(0)
	pixel_filter.item_selected.connect(func(index: int):
		Settings.set_pixel_filter_mode(pixel_filter.get_item_id(index))
	)
	content.add_child(pixel_filter)
	content.add_child(_label("Key / controller remapping", 18, Color("#d4e0c9")))
	var bindings_grid := GridContainer.new()
	bindings_grid.columns = 3
	bindings_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bindings_grid.add_theme_constant_override("h_separation", 12)
	bindings_grid.add_theme_constant_override("v_separation", 6)
	for action in Settings.ACTIONS:
		var action_label := _label(action.replace("_", " ").capitalize(), 14, Color("#aabda1"))
		action_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		action_label.custom_minimum_size.x = 150.0
		bindings_grid.add_child(action_label)
		var binding := _button(Settings.binding_label(action), 14)
		binding.custom_minimum_size = Vector2(170.0, 32.0)
		binding.pressed.connect(_begin_rebind.bind(action, binding))
		bindings_grid.add_child(binding)
		var hint := _label("click then press a key/button", 12, Color("#83927d"))
		hint.autowrap_mode = TextServer.AUTOWRAP_OFF
		hint.custom_minimum_size.x = 270.0
		bindings_grid.add_child(hint)
	content.add_child(bindings_grid)
	var back := _button("Back", 17)
	back.pressed.connect(_return_from_settings.bind(back_mode))
	content.add_child(back)

func _begin_rebind(action: String, button: Button) -> void:
	rebinding_action = action
	rebinding_button = button
	button.text = "Press a key or controller button..."

func _finish_rebind() -> void:
	if rebinding_button:
		rebinding_button.text = Settings.binding_label(rebinding_action)
	rebinding_action = ""
	rebinding_button = null

func _return_from_settings(back_mode: String) -> void:
	match back_mode:
		"pause": show_pause()
		"levels": show_level_select()
		_: show_title()

func _clear_menu() -> void:
	for child in menu.get_children():
		child.queue_free()

func _center_panel(size: Vector2) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = size
	panel.size = size
	panel.set_anchors_preset(Control.PRESET_CENTER)
	panel.position = -size * 0.5
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#132119e8")
	style.border_color = Color("#637d5c")
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.content_margin_left = 28.0
	style.content_margin_right = 28.0
	style.content_margin_top = 24.0
	style.content_margin_bottom = 24.0
	panel.add_theme_stylebox_override("panel", style)
	menu.add_child(panel)
	return panel

func _label(text: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	return label

func _button(text: String, font_size: int) -> Button:
	var button := Button.new()
	button.text = text
	button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	button.add_theme_font_size_override("font_size", font_size)
	button.custom_minimum_size.y = 40.0
	return button

func _time_text(seconds: float) -> String:
	var minutes := int(seconds / 60.0)
	var remainder := seconds - minutes * 60.0
	return "%02d:%06.3f" % [minutes, remainder]
