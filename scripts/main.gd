extends Node3D

const LEVELS := preload("res://scripts/level_library.gd")

var course: Node3D
var player: SpeedPlayer
var ghost: RunGhost
var current_level: Dictionary = {}
var collected_in_level := 0

var ui: CanvasLayer
var hud: Control
var menu: Control
var timer_label: Label
var par_label: Label
var collect_label: Label
var briefing_label: Label
var rebinding_action := ""
var rebinding_button: Button
var menu_mode := "title"

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_world()
	_build_ui()
	show_title()

func _build_world() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("#17231d")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("#92a87d")
	settings.ambient_light_energy = 0.55
	settings.fog_enabled = true
	settings.fog_light_color = Color("#5f765f")
	settings.fog_light_energy = 0.65
	settings.fog_density = 0.008
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52.0, -36.0, 0.0)
	sun.light_color = Color("#d4d7ac")
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	add_child(sun)
	var fill := OmniLight3D.new()
	fill.position = Vector3(0.0, 9.0, 3.0)
	fill.light_color = Color("#78966c")
	fill.omni_range = 30.0
	fill.light_energy = 1.2
	add_child(fill)

func _build_ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 10
	ui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(ui)
	hud = Control.new()
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud)
	var top := HBoxContainer.new()
	top.position = Vector2(22.0, 20.0)
	top.add_theme_constant_override("separation", 16)
	hud.add_child(top)
	timer_label = _label("00:00.000", 32, Color("#edf3d5"))
	par_label = _label("PAR --:--.---", 16, Color("#b5c6a5"))
	collect_label = _label("◇ 0/0", 16, Color("#f2d98c"))
	timer_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	par_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	collect_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	timer_label.custom_minimum_size = Vector2(170.0, 42.0)
	par_label.custom_minimum_size = Vector2(170.0, 28.0)
	collect_label.custom_minimum_size = Vector2(100.0, 28.0)
	top.add_child(timer_label)
	top.add_child(par_label)
	top.add_child(collect_label)
	briefing_label = _label("", 22, Color("#e9f0d8"))
	briefing_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	briefing_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	briefing_label.position.y = 84.0
	briefing_label.size.x = 640.0
	briefing_label.position.x = -320.0
	hud.add_child(briefing_label)
	hud.visible = false
	menu = Control.new()
	menu.process_mode = Node.PROCESS_MODE_ALWAYS
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	menu.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui.add_child(menu)

func _process(delta: float) -> void:
	if not rebinding_action.is_empty():
		return
	if get_tree().paused:
		if Input.is_action_just_pressed("pause"):
			resume_run()
		return
	if RunData.running:
		RunData.advance(delta)
		_refresh_hud()
		if Input.is_action_just_pressed("pause"):
			show_pause()

func _input(event: InputEvent) -> void:
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
	get_tree().paused = false
	RunData.running = false
	if player:
		player.movement_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.visible = false
	_clear_menu()
	var panel := _center_panel(Vector2(680.0, 520.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	box.add_child(_label("a-slow-walk", 46, Color("#edf3d5")))
	box.add_child(_label("a quiet forest speedrunner", 18, Color("#9db197")))
	var divider := HSeparator.new()
	box.add_child(divider)
	box.add_child(_label("Race your best ghost.\nEvery level is open. Every line can be faster.", 18, Color("#d3dec5")))
	var start := _button("Choose a level", 22)
	start.pressed.connect(show_level_select)
	box.add_child(start)
	var settings := _button("Settings", 18)
	settings.pressed.connect(show_settings.bind("title"))
	box.add_child(settings)
	box.add_child(_label("WASD + Mouse · Space jump/wall jump · Q slam · Shift dash · Ctrl slide · R reset", 14, Color("#8ea18a")))

func show_level_select() -> void:
	menu_mode = "levels"
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.visible = false
	_clear_menu()
	var panel := _center_panel(Vector2(780.0, 610.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	box.add_child(_label("Choose a trail", 34, Color("#edf3d5")))
	box.add_child(_label("Beat the par. Leave a better ghost.", 16, Color("#aabda1")))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 8)
	box.add_child(grid)
	for level in LEVELS.all_levels():
		var best := RunData.best_time_for(level.id)
		var record_text := "PB —" if best < 0.0 else "PB " + _time_text(best)
		var button := _button(level.title + "\nPAR " + _time_text(level.par) + "  ·  " + record_text, 16)
		button.custom_minimum_size = Vector2(350.0, 56.0)
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
	get_tree().paused = false
	_clear_menu()
	current_level = LEVELS.by_id(level_id)
	collected_in_level = 0
	_build_course(current_level)
	RunData.begin_run(level_id)
	hud.visible = true
	briefing_label.text = current_level.title + " — " + current_level.briefing
	var tween := create_tween()
	tween.tween_property(briefing_label, "modulate:a", 0.0, 0.3).set_delay(4.0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_refresh_hud()

func _build_course(level: Dictionary) -> void:
	if course:
		course.queue_free()
	course = Node3D.new()
	course.name = "Course"
	add_child(course)
	var start_floor := _make_platform(Vector3(0.0, 0.0, 2.0), Vector3(8.0, 0.7, 9.0), Color("#39553e"))
	course.add_child(start_floor)
	player = SpeedPlayer.new()
	player.position = Vector3(0.0, 0.9, 3.0)
	player.reset_requested.connect(_restart_level)
	course.add_child(player)
	var segments := int(ceil(float(level.length) / 4.8))
	var route_offset: float = float(level.get("offset", 0.0))
	for index in range(segments):
		var z := -3.5 - index * 4.8
		var x: float = sin(float(index) * 0.85) * (1.1 + abs(route_offset) * 0.36) + route_offset
		var y := 0.0
		if level.launches and index > 7:
			y = sin(float(index) * 0.75) * 1.4 + 1.0
		var width := 5.8 if index % 4 != 2 else 4.4
		course.add_child(_make_platform(Vector3(x, y, z), Vector3(width, 0.7, 3.5), Color("#486443")))
		if level.boosts and index in [3, 8, 12]:
			course.add_child(_make_boost(Vector3(x, y + 0.42, z), Vector3(0.0, 0.0, -1.0)))
		if level.launches and index in [5, 11]:
			course.add_child(_make_launch(Vector3(x, y + 0.45, z)))
		if index % 3 == 1:
			course.add_child(_make_collectible(Vector3(x + 1.7, y + 1.25, z - 0.5)))
		if index % 2 == 0:
			_add_tree(Vector3(x + 5.5, y, z + 1.0), 0.8 + float(index % 3) * 0.18)
			_add_tree(Vector3(x - 5.2, y, z - 1.0), 0.7 + float((index + 1) % 3) * 0.2)
	var goal_z := -4.5 - segments * 4.8
	var goal_x: float = sin(float(segments) * 0.85) * (1.1 + abs(route_offset) * 0.36) + route_offset
	course.add_child(_make_platform(Vector3(goal_x, 0.0, goal_z), Vector3(8.0, 0.7, 7.0), Color("#5b7749")))
	course.add_child(_make_goal(Vector3(goal_x, 1.1, goal_z - 1.0)))
	ghost = RunGhost.new()
	ghost.set_frames(RunData.ghost_for(level.id))
	course.add_child(ghost)

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

func _make_goal(position: Vector3) -> CourseTrigger:
	var goal := _trigger(CourseTrigger.TriggerType.GOAL, Vector3(4.0, 3.0, 3.0), null)
	goal.position = position
	var visual := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.75
	ring.outer_radius = 1.0
	visual.mesh = ring
	visual.rotation.x = deg_to_rad(90.0)
	visual.material_override = _material(Color("#d9cb72"), true)
	goal.add_child(visual)
	return goal

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

func _trigger(type: CourseTrigger.TriggerType, size: Vector3, payload: Variant) -> CourseTrigger:
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
		CourseTrigger.TriggerType.GOAL:
			_complete_level()
		CourseTrigger.TriggerType.COLLECTIBLE:
			collected_in_level += 1
			RunData.add_collectible()
			Audio.play_sfx("pickup")
			_refresh_hud()
		CourseTrigger.TriggerType.BOOST:
			player.apply_boost(payload)
			Audio.play_sfx("boost")
		CourseTrigger.TriggerType.LAUNCH:
			player.launch(float(payload))
			Audio.play_sfx("launch")

func _add_tree(position: Vector3, scale_factor: float) -> void:
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
		crown.material_override = _material(Color("#496848"))
		tree.add_child(crown)
	course.add_child(tree)

func _material(color: Color, emissive := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.88
	if emissive:
		material.emission_enabled = true
		material.emission = color
		material.emission_energy_multiplier = 1.5
	return material

func _restart_level() -> void:
	if current_level.is_empty() or not RunData.running:
		return
	start_level(current_level.id)

func _complete_level() -> void:
	if not RunData.running:
		return
	var result := RunData.finish_run()
	player.movement_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Audio.play_sfx("finish")
	show_results(result)

func _refresh_hud() -> void:
	if current_level.is_empty():
		return
	timer_label.text = _time_text(RunData.elapsed)
	par_label.text = "PAR " + _time_text(float(current_level.par))
	var total := _collectible_count(current_level)
	collect_label.text = "◇ %d/%d" % [RunData.collected, total]

func _collectible_count(level: Dictionary) -> int:
	var segments := int(ceil(float(level.length) / 4.8))
	var count := 0
	for index in range(segments):
		if index % 3 == 1:
			count += 1
	return count

func show_pause() -> void:
	if not RunData.running:
		return
	menu_mode = "pause"
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_clear_menu()
	var panel := _center_panel(Vector2(430.0, 360.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Paused", 34, Color("#edf3d5")))
	var resume := _button("Resume", 19)
	resume.pressed.connect(resume_run)
	box.add_child(resume)
	var restart := _button("Restart run", 19)
	restart.pressed.connect(func():
		get_tree().paused = false
		_restart_level()
	)
	box.add_child(restart)
	var settings := _button("Settings", 19)
	settings.pressed.connect(show_settings.bind("pause"))
	box.add_child(settings)
	var levels := _button("Level select", 19)
	levels.pressed.connect(show_level_select)
	box.add_child(levels)

func resume_run() -> void:
	get_tree().paused = false
	_clear_menu()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func show_results(result: Dictionary) -> void:
	menu_mode = "results"
	hud.visible = false
	_clear_menu()
	var panel := _center_panel(Vector2(500.0, 430.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Trail complete", 34, Color("#edf3d5")))
	box.add_child(_label(current_level.title, 18, Color("#aabda1")))
	box.add_child(_label(_time_text(float(result.time)), 44, Color("#f2d98c")))
	var par := float(current_level.par)
	box.add_child(_label("PAR " + _time_text(par) + ("  ·  BEAT" if float(result.time) <= par else "  ·  KEEP PUSHING"), 18, Color("#d4e0c9")))
	box.add_child(_label("Collectibles %d/%d" % [int(result.collectibles), _collectible_count(current_level)], 18, Color("#d4e0c9")))
	if bool(result.is_pb):
		box.add_child(_label("NEW PERSONAL BEST — ghost saved", 16, Color("#8ed6ae")))
	var again := _button("Run it again", 19)
	again.pressed.connect(_restart_after_result)
	box.add_child(again)
	var levels := _button("Level select", 19)
	levels.pressed.connect(show_level_select)
	box.add_child(levels)

func _restart_after_result() -> void:
	start_level(current_level.id)

func show_settings(back_mode: String) -> void:
	menu_mode = "settings"
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
	button.text = "Press a key or controller button…"

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
