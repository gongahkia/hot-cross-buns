extends Node3D

const LEVELS := preload("res://scripts/level_library.gd")
const PERFORMANCE_HISTOGRAM := preload("res://scripts/performance_histogram.gd")

var course: Node3D
var player: SpeedPlayer
var ghost: RunGhost
var current_level: Dictionary = {}
var collected_in_level := 0
var total_collectibles_in_level := 0
var traversal_ramp_count := 0
var climbable_trunk_count := 0

var ui: CanvasLayer
var hud: Control
var menu: Control
var display_filter: ColorRect
var display_filter_layer: CanvasLayer
var timer_label: Label
var par_label: Label
var collect_label: Label
var briefing_label: Label
var rebinding_action := ""
var rebinding_button: Button
var menu_mode := "title"
var foliage_shader: Shader
var pulse_shader: Shader
var ui_theme: Theme

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	ui_theme = _make_ui_theme()
	foliage_shader = _make_foliage_shader()
	pulse_shader = _make_pulse_shader()
	_build_world()
	_build_ui()
	Settings.pixel_filter_mode_changed.connect(_apply_pixel_filter)
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
	hud.theme = ui_theme
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud)
	var top := HBoxContainer.new()
	top.position = Vector2(22.0, 20.0)
	top.add_theme_constant_override("separation", 16)
	hud.add_child(top)
	timer_label = _label("00:00.000", 32, Color("#edf3d5"))
	par_label = _label("PAR --:--.---", 16, Color("#b5c6a5"))
	collect_label = _label("* 0/0", 16, Color("#f2d98c"))
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
	_apply_pixel_filter(Settings.pixel_filter_mode)

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
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
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
	box.add_child(_label("WASD + Mouse - Space jump/wall jump - Q slam - Shift dash - Ctrl slide - R reset", 14, Color("#8ea18a")))

func show_level_select() -> void:
	menu_mode = "levels"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
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
		var record_text := "PB -" if best < 0.0 else "PB " + _time_text(best)
		var button := _button(level.title + "\nPAR " + _time_text(level.par) + "  -  " + record_text, 16)
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
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	current_level = LEVELS.by_id(level_id)
	collected_in_level = 0
	_build_course(current_level)
	RunData.begin_run(level_id)
	hud.visible = true
	briefing_label.text = current_level.title + " - " + current_level.briefing
	var tween := create_tween()
	tween.tween_property(briefing_label, "modulate:a", 0.0, 0.3).set_delay(4.0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_refresh_hud()

func _build_course(level: Dictionary) -> void:
	if course:
		course.queue_free()
	course = Node3D.new()
	course.name = "Course"
	course.set_meta("layout_id", level.id)
	course.set_meta("focus", level.focus)
	add_child(course)
	_add_forest_motes()
	total_collectibles_in_level = 0
	traversal_ramp_count = 0
	climbable_trunk_count = 0
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
	player.position = Vector3(0.0, 0.9, 3.0)
	player.reset_requested.connect(_restart_level)
	course.add_child(player)
	_build_open_terrain(world_length, world_width, str(level.terrain_style))
	match str(level.id):
		"01-trailhead":
			_build_trailhead(summit_surface, palette)
		"02-moss-run":
			_build_moss_run(summit_surface, palette)
		"03-canopy-gap":
			_build_canopy_gap(summit_surface, palette)
		"04-root-tunnel":
			_build_root_tunnel(summit_surface, palette)
		"05-sky-sap":
			_build_sky_sap(summit_surface, palette)
		"06-wild-line":
			_build_wild_line(summit_surface, palette)
		"07-green-light":
			_build_green_light(summit_surface, palette)
		_:
			push_error("Unknown level layout: " + str(level.id))
	var summit := _make_platform(summit_surface - Vector3(0.0, 0.45, 0.0), Vector3(13.0, 0.9, 12.0), palette.summit)
	summit.name = "Summit"
	course.add_child(summit)
	course.add_child(_make_goal(summit_surface + Vector3(0.0, 1.15, -1.0)))
	ghost = RunGhost.new()
	ghost.set_frames(RunData.ghost_for(level.id))
	course.add_child(ghost)

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

func _build_trailhead(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "jump + double-jump")
	var safe_points: Array[Vector3] = [Vector3(-4.0, 0.4, -4.0), Vector3(-11.0, 1.3, -13.0), Vector3(-11.0, 2.7, -24.0), Vector3(-7.0, 4.0, -35.0), Vector3(-3.0, 5.5, -45.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.0, 0.8, 7.5), 6.5, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-12.0, 2.5, -13.0), Vector3(-9.2, 4.0, -24.0), Vector3(-4.8, 6.8, -45.0)])
	_add_course_sign(safe, Vector3(-8.0, 3.4, -20.0), "SAFE RIDGE", palette.sign)
	var expert_a := _route("ExpertRouteA", "double-jump shortcuts")
	var islands: Array[Vector3] = [Vector3(5.0, 0.6, -8.0), Vector3(8.5, 2.0, -17.0), Vector3(5.8, 3.8, -27.0), Vector3(2.8, 5.2, -37.0)]
	_add_route_islands(expert_a, islands, Vector3(5.2, 0.7, 5.2), palette.expert)
	expert_a.add_child(_make_ramp_between(Vector3(3.0, 0.4, -3.0), islands[0], 4.4, palette.ramp))
	_add_route_collectibles(expert_a, [Vector3(8.5, 3.2, -17.0), Vector3(5.8, 5.0, -27.0), Vector3(2.8, 6.4, -37.0)])
	_add_course_sign(expert_a, Vector3(7.0, 4.3, -20.0), "DOUBLE JUMP LINE", palette.sign)
	var expert_b := _route("ExpertRouteB", "corner cuts")
	_add_route_path(expert_b, [Vector3(10.0, 0.5, -7.0), Vector3(11.0, 2.2, -20.0), Vector3(8.0, 4.2, -31.0), Vector3(2.8, 5.2, -37.0)], Vector3(4.2, 0.7, 5.2), 3.1, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(11.0, 3.4, -20.0), Vector3(8.0, 5.4, -31.0)])
	_build_finale(Vector3(2.8, 5.2, -37.0), summit, palette, "LANDING FINALE")

func _build_moss_run(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "readable recovery ridge")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -5.0), Vector3(-14.0, 1.1, -17.0), Vector3(-14.0, 2.5, -31.0), Vector3(-9.0, 4.0, -45.0), Vector3(-4.0, 5.7, -55.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.4, 0.8, 7.8), 6.8, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-15.0, 2.3, -17.0), Vector3(-10.5, 5.1, -45.0)])
	var expert_a := _route("ExpertRouteA", "boost carry")
	var boost_points: Array[Vector3] = [Vector3(3.0, 0.5, -7.0), Vector3(10.0, 1.8, -20.0), Vector3(12.0, 3.5, -34.0), Vector3(7.0, 5.2, -48.0), Vector3(3.0, 6.1, -55.0)]
	_add_route_path(expert_a, boost_points, Vector3(5.2, 0.7, 6.0), 3.5, palette.expert, palette.ramp)
	for index in range(boost_points.size() - 1):
		var direction := Vector3(boost_points[index + 1].x - boost_points[index].x, 0.0, boost_points[index + 1].z - boost_points[index].z).normalized()
		expert_a.add_child(_make_boost(boost_points[index] + Vector3(0.0, 0.42, -1.2), direction))
	_add_route_collectibles(expert_a, [Vector3(10.0, 3.0, -20.0), Vector3(12.0, 4.7, -34.0), Vector3(7.0, 6.4, -48.0)])
	_add_course_sign(expert_a, Vector3(10.0, 4.0, -28.0), "CHAIN BOOSTS", palette.sign)
	var expert_b := _route("ExpertRouteB", "banked turns")
	_add_route_path(expert_b, [Vector3(15.0, 0.5, -10.0), Vector3(16.0, 2.0, -27.0), Vector3(14.0, 4.0, -42.0), Vector3(6.0, 5.9, -55.0)], Vector3(4.4, 0.7, 6.4), 3.0, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(16.0, 3.2, -27.0), Vector3(14.0, 5.2, -42.0), Vector3(6.0, 7.1, -55.0)])
	_build_finale(Vector3(3.0, 6.1, -55.0), summit, palette, "MOSS SPRINT")

func _build_canopy_gap(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "visible low recovery")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -4.0), Vector3(-15.0, 1.0, -17.0), Vector3(-15.0, 2.4, -33.0), Vector3(-10.0, 4.0, -47.0), Vector3(-4.0, 5.8, -59.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.5, 0.8, 8.0), 6.6, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-16.0, 2.2, -17.0), Vector3(-11.5, 5.2, -47.0)])
	var expert_a := _route("ExpertRouteA", "air dash islands")
	var dash_islands: Array[Vector3] = [Vector3(5.0, 1.1, -10.0), Vector3(11.0, 2.6, -21.0), Vector3(8.0, 4.2, -34.0), Vector3(12.0, 5.5, -47.0), Vector3(5.0, 6.1, -58.0)]
	_add_route_islands(expert_a, dash_islands, Vector3(4.8, 0.7, 4.8), palette.expert)
	expert_a.add_child(_make_ramp_between(Vector3(3.0, 0.4, -3.0), dash_islands[0], 4.2, palette.ramp))
	_add_route_collectibles(expert_a, [Vector3(11.0, 3.8, -21.0), Vector3(8.0, 5.4, -34.0), Vector3(12.0, 6.7, -47.0)])
	_add_course_sign(expert_a, Vector3(9.0, 4.9, -26.0), "DASH EACH GAP", palette.sign)
	var expert_b := _route("ExpertRouteB", "canopy corners")
	_add_route_path(expert_b, [Vector3(16.0, 0.5, -9.0), Vector3(17.0, 2.3, -26.0), Vector3(14.0, 4.7, -43.0), Vector3(7.0, 6.1, -58.0)], Vector3(4.3, 0.7, 5.8), 3.0, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(17.0, 3.5, -26.0), Vector3(14.0, 5.9, -43.0), Vector3(7.0, 7.3, -58.0)])
	_build_finale(Vector3(5.0, 6.1, -58.0), summit, palette, "CANOPY EXIT")

func _build_root_tunnel(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "root ridge")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -5.0), Vector3(-13.0, 1.2, -19.0), Vector3(-13.0, 2.6, -35.0), Vector3(-8.0, 4.3, -50.0), Vector3(-3.0, 5.9, -63.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.2, 0.8, 7.8), 6.5, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-14.0, 2.4, -19.0), Vector3(-14.0, 3.8, -35.0), Vector3(-4.5, 7.1, -63.0)])
	var expert_a := _route("ExpertRouteA", "slide carry")
	var chute_points: Array[Vector3] = [Vector3(4.0, 0.5, -7.0), Vector3(9.0, 1.7, -23.0), Vector3(10.0, 3.5, -41.0), Vector3(5.0, 5.6, -58.0), Vector3(2.0, 6.2, -64.0)]
	_add_route_path(expert_a, chute_points, Vector3(5.8, 0.7, 7.2), 4.2, palette.expert, palette.ramp)
	for index in range(chute_points.size() - 1):
		var direction := Vector3(chute_points[index + 1].x - chute_points[index].x, 0.0, chute_points[index + 1].z - chute_points[index].z).normalized()
		expert_a.add_child(_make_boost(chute_points[index] + Vector3(0.0, 0.42, -1.6), direction))
		_add_root_arch(expert_a, chute_points[index] + Vector3(0.0, 0.0, -3.0), 6.6, palette.root)
	_add_route_collectibles(expert_a, [Vector3(9.0, 3.0, -23.0), Vector3(10.0, 4.8, -41.0), Vector3(5.0, 6.9, -58.0)])
	_add_course_sign(expert_a, Vector3(9.0, 4.2, -31.0), "HOLD SLIDE", palette.sign)
	var expert_b := _route("ExpertRouteB", "outer root line")
	_add_route_path(expert_b, [Vector3(15.0, 0.5, -11.0), Vector3(16.0, 2.2, -29.0), Vector3(13.0, 4.4, -48.0), Vector3(6.0, 6.0, -63.0)], Vector3(4.4, 0.7, 6.0), 3.2, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(16.0, 3.4, -29.0), Vector3(13.0, 5.6, -48.0)])
	_build_finale(Vector3(2.0, 6.2, -64.0), summit, palette, "ROOT EXIT")

func _build_sky_sap(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "low branch climb")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -5.0), Vector3(-16.0, 1.1, -20.0), Vector3(-16.0, 2.6, -38.0), Vector3(-10.0, 4.2, -55.0), Vector3(-4.0, 5.9, -68.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.6, 0.8, 8.0), 6.7, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-17.0, 2.3, -20.0), Vector3(-11.5, 5.4, -55.0)])
	var expert_a := _route("ExpertRouteA", "launch pad ascent")
	var launch_points: Array[Vector3] = [Vector3(5.0, 0.5, -10.0), Vector3(10.0, 3.1, -24.0), Vector3(13.0, 5.0, -42.0), Vector3(7.0, 6.2, -60.0), Vector3(3.0, 6.4, -69.0)]
	_add_route_path(expert_a, launch_points, Vector3(5.8, 0.7, 6.2), 3.8, palette.expert, palette.ramp)
	expert_a.add_child(_make_launch(launch_points[0] + Vector3(0.0, 0.42, -1.1)))
	expert_a.add_child(_make_launch(launch_points[1] + Vector3(0.0, 0.42, -1.1)))
	expert_a.add_child(_make_launch(launch_points[2] + Vector3(0.0, 0.42, -1.1)))
	_add_route_collectibles(expert_a, [Vector3(10.0, 4.4, -24.0), Vector3(13.0, 6.3, -42.0), Vector3(7.0, 7.5, -60.0)])
	_add_course_sign(expert_a, Vector3(10.5, 5.5, -31.0), "LAUNCH HIGH", palette.sign)
	var expert_b := _route("ExpertRouteB", "sap canopy")
	_add_route_path(expert_b, [Vector3(17.0, 0.5, -12.0), Vector3(18.0, 2.3, -31.0), Vector3(15.0, 4.4, -50.0), Vector3(7.0, 6.0, -68.0)], Vector3(4.4, 0.7, 6.0), 3.1, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(18.0, 3.5, -31.0), Vector3(15.0, 5.6, -50.0), Vector3(7.0, 7.2, -68.0)])
	_build_finale(Vector3(3.0, 6.4, -69.0), summit, palette, "SKY SAP FINALE")

func _build_wild_line(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "ridge recovery")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -5.0), Vector3(-17.0, 1.0, -21.0), Vector3(-17.0, 2.4, -40.0), Vector3(-11.0, 4.1, -58.0), Vector3(-5.0, 5.8, -72.0), summit]
	_add_route_path(safe, safe_points, Vector3(9.8, 0.8, 8.2), 6.8, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-18.0, 2.2, -21.0), Vector3(-12.5, 5.3, -58.0)])
	var expert_a := _route("ExpertRouteA", "wall-jump trunks")
	var wall_points: Array[Vector3] = [Vector3(5.0, 0.5, -10.0), Vector3(10.0, 2.2, -27.0), Vector3(10.0, 4.1, -46.0), Vector3(5.0, 5.9, -65.0), Vector3(2.0, 6.4, -73.0)]
	_add_route_path(expert_a, wall_points, Vector3(5.0, 0.7, 5.6), 3.2, palette.expert, palette.ramp)
	for index in range(4):
		_add_climbable_trunk(wall_points[index] + Vector3(2.1 if index % 2 == 0 else -2.1, -0.4, -1.5), 6.0 + float(index) * 1.4, 0.5, expert_a)
	_add_route_collectibles(expert_a, [Vector3(10.0, 3.6, -27.0), Vector3(10.0, 5.5, -46.0), Vector3(5.0, 7.3, -65.0)])
	_add_course_sign(expert_a, Vector3(9.0, 5.0, -36.0), "WALL JUMP", palette.sign)
	var expert_b := _route("ExpertRouteB", "wild bank")
	_add_route_path(expert_b, [Vector3(18.0, 0.5, -13.0), Vector3(19.0, 2.1, -33.0), Vector3(15.0, 4.5, -54.0), Vector3(7.0, 6.1, -72.0)], Vector3(4.5, 0.7, 6.2), 3.2, palette.expert, palette.ramp)
	_add_route_collectibles(expert_b, [Vector3(19.0, 3.3, -33.0), Vector3(15.0, 5.7, -54.0), Vector3(7.0, 7.3, -72.0)])
	_build_finale(Vector3(2.0, 6.4, -73.0), summit, palette, "WILD FINISH")

func _build_green_light(summit: Vector3, palette: Dictionary) -> void:
	var safe := _route("SafeRoute", "full-route recovery")
	var safe_points: Array[Vector3] = [Vector3(-5.0, 0.4, -5.0), Vector3(-18.0, 1.0, -22.0), Vector3(-18.0, 2.4, -43.0), Vector3(-12.0, 4.0, -62.0), Vector3(-5.0, 5.7, -78.0), summit]
	_add_route_path(safe, safe_points, Vector3(10.0, 0.8, 8.2), 6.9, palette.safe, palette.ramp)
	_add_route_collectibles(safe, [Vector3(-19.0, 2.2, -22.0), Vector3(-13.5, 5.2, -62.0)])
	var expert_a := _route("ExpertRouteA", "boost, dash, launch")
	var fast_points: Array[Vector3] = [Vector3(4.0, 0.5, -9.0), Vector3(12.0, 2.0, -27.0), Vector3(14.0, 4.0, -48.0), Vector3(8.0, 5.8, -68.0), Vector3(3.0, 6.5, -79.0)]
	_add_route_path(expert_a, fast_points, Vector3(5.4, 0.7, 6.0), 3.5, palette.expert, palette.ramp)
	for index in range(fast_points.size() - 1):
		var direction := Vector3(fast_points[index + 1].x - fast_points[index].x, 0.0, fast_points[index + 1].z - fast_points[index].z).normalized()
		expert_a.add_child(_make_boost(fast_points[index] + Vector3(0.0, 0.42, -1.1), direction))
	expert_a.add_child(_make_launch(fast_points[2] + Vector3(0.0, 0.42, -1.2)))
	_add_route_collectibles(expert_a, [Vector3(12.0, 3.4, -27.0), Vector3(14.0, 5.4, -48.0), Vector3(8.0, 7.0, -68.0)])
	_add_course_sign(expert_a, Vector3(12.0, 5.0, -38.0), "CHAIN THE KIT", palette.sign)
	var expert_b := _route("ExpertRouteB", "wall and canopy line")
	var wall_points: Array[Vector3] = [Vector3(20.0, 0.5, -13.0), Vector3(21.0, 2.2, -34.0), Vector3(17.0, 4.6, -56.0), Vector3(8.0, 6.0, -78.0)]
	_add_route_path(expert_b, wall_points, Vector3(4.6, 0.7, 6.2), 3.1, palette.expert, palette.ramp)
	for index in range(3):
		_add_climbable_trunk(wall_points[index] + Vector3(-2.0, -0.4, -1.5), 6.2 + float(index) * 1.5, 0.5, expert_b)
	_add_route_collectibles(expert_b, [Vector3(21.0, 3.4, -34.0), Vector3(17.0, 5.8, -56.0), Vector3(8.0, 7.2, -78.0)])
	_build_finale(Vector3(3.0, 6.5, -79.0), summit, palette, "GREEN LIGHT")

func _build_finale(start: Vector3, summit: Vector3, palette: Dictionary, label: String) -> void:
	var finale := _route("Finale", "high-power finish")
	var midpoint := Vector3(lerpf(start.x, summit.x, 0.42), minf(start.y + 0.55, summit.y - 0.35), lerpf(start.z, summit.z, 0.45))
	_add_route_path(finale, [start, midpoint, summit], Vector3(6.0, 0.7, 6.0), 4.5, palette.finale, palette.ramp)
	var direction := Vector3(summit.x - start.x, 0.0, summit.z - start.z).normalized()
	finale.add_child(_make_boost(start + Vector3(0.0, 0.42, -1.3), direction))
	_add_course_sign(finale, midpoint + Vector3(0.0, 2.3, 0.0), label, palette.sign)

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
void fragment() {
	vec2 cell = SCREEN_PIXEL_SIZE * pixel_size;
	vec2 sample_uv = (floor(SCREEN_UV / cell) + vec2(0.5)) * cell;
	COLOR = texture(screen_texture, sample_uv);
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
	collect_label.text = "* %d/%d" % [RunData.collected, total]

func _collectible_count(level: Dictionary) -> int:
	return total_collectibles_in_level

func show_pause() -> void:
	if not RunData.running:
		return
	menu_mode = "pause"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
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
	menu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func show_results(result: Dictionary) -> void:
	menu_mode = "results"
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	hud.visible = false
	_clear_menu()
	var panel := _center_panel(Vector2(760.0, 610.0))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(_label("Run analysis", 34, Color("#edf3d5")))
	box.add_child(_label(current_level.title, 18, Color("#aabda1")))
	box.add_child(_label(_time_text(float(result.time)), 44, Color("#f2d98c")))
	var par := float(current_level.par)
	box.add_child(_label("PAR " + _time_text(par) + ("  -  BEAT" if float(result.time) <= par else "  -  KEEP PUSHING"), 18, Color("#d4e0c9")))
	var best_time := float(result.get("best_time", result.time))
	var attempts := int(result.get("attempts", 1))
	var delta := float(result.time) - best_time
	var performance_text := "ATTEMPTS %d  -  NEW PB" % attempts if bool(result.is_pb) else "ATTEMPTS %d  -  PB +%s" % [attempts, _time_text(delta)]
	box.add_child(_label(performance_text, 16, Color("#8ed6ae") if bool(result.is_pb) else Color("#d6bd7b")))
	var histogram := PERFORMANCE_HISTOGRAM.new()
	histogram.name = "PerformanceHistogram"
	histogram.set_data(RunData.attempt_history_for(current_level.id), float(result.time), best_time)
	box.add_child(histogram)
	box.add_child(_label("Collectibles %d/%d" % [int(result.collectibles), _collectible_count(current_level)], 18, Color("#d4e0c9")))
	if bool(result.is_pb):
		box.add_child(_label("NEW PERSONAL BEST - ghost saved", 16, Color("#8ed6ae")))
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
