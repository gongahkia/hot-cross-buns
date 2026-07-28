class_name CreativeEditor
extends Node

const LEVEL_DOCUMENT := preload("res://scripts/level_document.gd")

signal document_changed(change: Dictionary)
signal playtest_requested
signal close_requested

var host: Node3D
var document: Variant
var geometry_root: Node3D
var overlay: CanvasLayer
var root: Control
var module_list: VBoxContainer
var status_label: Label
var selected_label: Label
var report_label: Label
var inspector: Dictionary = {}
var creative_rig: Node3D
var creative_camera: Camera3D
var active := false
var top_down := false
var selected_kind := ""
var selected_module_id := ""
var selected_module_ids: Array[String] = []
var yaw := 0.0
var pitch := -0.32
var top_focus := Vector3(0.0, 0.0, -35.0)
var top_camera_altitude := 56.0
var fly_speed := 22.0
var authoring_mode := ""
var trace_points: Array[Vector3] = []
var selected_reference_id := ""
var calibration_distance: SpinBox
var snap_toggle: CheckBox
var snap_step: SpinBox
var reference_picker: OptionButton
var reference_fields: Dictionary = {}
var history_label: Label
var evidence_label: Label
var latest_playtest_report: Dictionary = {}
var selection_box: Panel
var right_drag_start := Vector2.ZERO
var right_drag_current := Vector2.ZERO
var right_dragging := false

const CAMERA_ZOOM_STEP := 4.0
const SELECTION_DRAG_THRESHOLD := 6.0

func configure(next_host: Node3D, next_document: Variant, next_geometry_root: Node3D) -> void:
	host = next_host
	document = next_document
	geometry_root = next_geometry_root
	_ensure_ui()
	_ensure_camera()
	_refresh_ui()

func open() -> void:
	if host == null or document == null:
		return
	active = true
	root.visible = true
	creative_camera.current = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_update_camera(true)
	_refresh_ui()

func close() -> void:
	active = false
	if root:
		root.visible = false
	if creative_camera:
		creative_camera.current = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func is_open() -> bool:
	return active

func set_geometry_root(next_geometry_root: Node3D) -> void:
	geometry_root = next_geometry_root
	_clear_selection()
	_refresh_ui()

func _process(delta: float) -> void:
	if not active or creative_rig == null:
		return
	var move := Vector3.ZERO
	if Input.is_key_pressed(KEY_W): move.z -= 1.0
	if Input.is_key_pressed(KEY_S): move.z += 1.0
	if Input.is_key_pressed(KEY_A): move.x -= 1.0
	if Input.is_key_pressed(KEY_D): move.x += 1.0
	if Input.is_key_pressed(KEY_SPACE): move.y += 1.0
	if Input.is_key_pressed(KEY_SHIFT): move.y -= 1.0
	if move.length() > 0.0:
		var speed := fly_speed * (2.0 if Input.is_key_pressed(KEY_CTRL) else 1.0)
		if top_down:
			top_focus += Vector3(move.x, 0.0, move.z) * speed * delta
			top_camera_altitude = clampf(top_camera_altitude + move.y * speed * delta, 10.0, 200.0)
		else:
			creative_rig.global_position += creative_rig.global_transform.basis * move.normalized() * speed * delta
	_update_camera(false)

func _unhandled_input(event: InputEvent) -> void:
	if not active:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_ENTER and authoring_mode == "route":
			_finish_route_trace()
			get_viewport().set_input_as_handled()
			return
		if event.physical_keycode == KEY_TAB:
			top_down = not top_down
			_set_status("TOP-DOWN MAP" if top_down else "FREE-FLY VIEW")
			_update_camera(true)
			get_viewport().set_input_as_handled()
			return
		if event.physical_keycode == KEY_ESCAPE:
			selected_kind = ""
			_clear_selection()
			_refresh_ui()
			get_viewport().set_input_as_handled()
			return
		if event.physical_keycode == KEY_DELETE and not selected_module_ids.is_empty():
			_remove()
			get_viewport().set_input_as_handled()
			return
		if event.physical_keycode == KEY_D and event.ctrl_pressed and not selected_module_ids.is_empty():
			_apply({"action": "duplicate_module", "module_id": selected_module_id})
			get_viewport().set_input_as_handled()
			return
	if event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		var zoom_direction := -1.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0
		creative_camera.fov = clampf(creative_camera.fov + zoom_direction * CAMERA_ZOOM_STEP * maxf(event.factor, 1.0), 30.0, 100.0)
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT:
		if event.pressed:
			right_drag_start = event.position
			right_drag_current = event.position
			right_dragging = false
			get_viewport().set_input_as_handled()
			return
		else:
			if top_down and right_dragging:
				_select_in_viewport_rect(_drag_rect())
			elif not right_dragging:
				_select_at_viewport(event.position)
			_hide_selection_box()
			get_viewport().set_input_as_handled()
			return
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		right_drag_current = event.position
		if top_down:
			if right_drag_current.distance_to(right_drag_start) >= SELECTION_DRAG_THRESHOLD:
				right_dragging = true
				_show_selection_box(_drag_rect())
		else:
			right_dragging = right_dragging or not is_zero_approx(event.relative.length())
			yaw -= event.relative.x * 0.004
			pitch = clampf(pitch - event.relative.y * 0.004, -1.45, 1.45)
			_update_camera(false)
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var point: Variant = _mouse_plane_point()
		if point != null:
			point = _snap_point(point)
			if authoring_mode == "calibrate":
				_trace_calibration(point)
			elif authoring_mode == "wall":
				_trace_wall(point)
			elif authoring_mode == "route":
				_trace_route(point)
			elif selected_kind.is_empty():
				_select_at(point)
			else:
				_place(selected_kind, point)
			get_viewport().set_input_as_handled()

func _ensure_camera() -> void:
	if creative_rig:
		return
	creative_rig = Node3D.new()
	creative_rig.name = "CreativeFlyRig"
	creative_rig.process_mode = Node.PROCESS_MODE_ALWAYS
	host.add_child(creative_rig)
	creative_camera = Camera3D.new()
	creative_camera.fov = 82.0
	creative_rig.add_child(creative_camera)
	creative_rig.global_position = Vector3(0.0, 13.0, 18.0)

func _ensure_ui() -> void:
	if overlay:
		return
	overlay = CanvasLayer.new()
	overlay.layer = 30
	overlay.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(overlay)
	root = Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(root)
	selection_box = Panel.new()
	selection_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	selection_box.visible = false
	var selection_style := StyleBoxFlat.new()
	selection_style.bg_color = Color("#8ed6ae33")
	selection_style.border_color = Color("#b9f6df")
	selection_style.set_border_width_all(1)
	selection_box.add_theme_stylebox_override("panel", selection_style)
	root.add_child(selection_box)
	var toolbar := PanelContainer.new()
	toolbar.position = Vector2(18.0, 16.0)
	toolbar.size = Vector2(1244.0, 48.0)
	toolbar.mouse_filter = Control.MOUSE_FILTER_STOP
	toolbar.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(toolbar)
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 8)
	toolbar.add_child(controls)
	for item in [["SAVE DRAFT", _save_draft], ["REFRESH DRAFT", _refresh_draft], ["UNDO", _undo], ["REDO", _redo], ["ROLLBACK PREV", _rollback_previous], ["MAP / FLY", _toggle_view], ["VALIDATE", _validate], ["CAPTURE", _capture_preview], ["PLAYTEST", _playtest], ["PUBLISH", _publish], ["EXIT", _exit]]:
		var button := _button(str(item[0]), 14)
		button.pressed.connect(item[1])
		controls.add_child(button)
	var left := PanelContainer.new()
	left.position = Vector2(18.0, 78.0)
	left.size = Vector2(240.0, 590.0)
	left.mouse_filter = Control.MOUSE_FILTER_STOP
	left.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(left)
	var left_scroll := ScrollContainer.new()
	left_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	left.add_child(left_scroll)
	var left_box := VBoxContainer.new()
	left_box.custom_minimum_size = Vector2(218.0, 0.0)
	left_box.add_theme_constant_override("separation", 5)
	left_scroll.add_child(left_box)
	left_box.add_child(_label("CREATIVE MODULES", 20, Color("#edf3d5")))
	left_box.add_child(_label("Click a module, then click the map/space to place it.", 12, Color("#9db197")))
	var module_scroll := ScrollContainer.new()
	module_scroll.custom_minimum_size = Vector2(0.0, 188.0)
	module_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	left_box.add_child(module_scroll)
	module_list = VBoxContainer.new()
	module_list.custom_minimum_size.x = 205.0
	module_list.add_theme_constant_override("separation", 2)
	module_scroll.add_child(module_list)
	var reference := _button("IMPORT REFERENCE", 14)
	reference.pressed.connect(_import_reference)
	left_box.add_child(reference)
	reference_picker = OptionButton.new()
	reference_picker.tooltip_text = "Active reference for calibration and tracing"
	reference_picker.item_selected.connect(_select_reference)
	left_box.add_child(reference_picker)
	var snap_row := HBoxContainer.new()
	snap_toggle = CheckBox.new()
	snap_toggle.text = "Snap"
	snap_toggle.button_pressed = true
	snap_row.add_child(snap_toggle)
	snap_step = SpinBox.new()
	snap_step.min_value = 0.1
	snap_step.max_value = 20.0
	snap_step.step = 0.1
	snap_step.value = 1.0
	snap_step.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	snap_row.add_child(snap_step)
	left_box.add_child(snap_row)
	left_box.add_child(_label("REFERENCE TRANSFORM", 14, Color("#edf3d5")))
	for item in [["x", "PAN X", -200.0, 200.0, 0.1], ["z", "PAN Z", -200.0, 200.0, 0.1], ["rotation_y", "ROTATE", -180.0, 180.0, 1.0], ["crop_x", "CROP X", 0.0, 1.0, 0.01], ["crop_y", "CROP Y", 0.0, 1.0, 0.01], ["crop_w", "CROP W", 0.01, 1.0, 0.01], ["crop_h", "CROP H", 0.01, 1.0, 0.01]]:
		var row := HBoxContainer.new()
		row.add_child(_label(str(item[1]), 11, Color("#9db197")))
		var field := SpinBox.new()
		field.min_value = float(item[2])
		field.max_value = float(item[3])
		field.step = float(item[4])
		field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(field)
		reference_fields[str(item[0])] = field
		left_box.add_child(row)
	var apply_reference := _button("APPLY REFERENCE", 13)
	apply_reference.pressed.connect(_apply_reference_transform)
	left_box.add_child(apply_reference)
	calibration_distance = SpinBox.new()
	calibration_distance.min_value = 0.1
	calibration_distance.max_value = 500.0
	calibration_distance.step = 0.1
	calibration_distance.value = 10.0
	calibration_distance.tooltip_text = "Known real-world distance between the next two plan clicks"
	left_box.add_child(calibration_distance)
	var calibrate := _button("CALIBRATE PLAN", 14)
	calibrate.pressed.connect(_begin_calibration)
	left_box.add_child(calibrate)
	var trace_wall := _button("TRACE WALL", 14)
	trace_wall.pressed.connect(_begin_wall_trace)
	left_box.add_child(trace_wall)
	var trace_route := _button("TRACE ROUTE", 14)
	trace_route.pressed.connect(_begin_route_trace)
	left_box.add_child(trace_route)
	left_box.add_child(_label("Route: click points, Enter to finish.", 11, Color("#9db197")))
	status_label = _label("READY", 13, Color("#b9f6df"))
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	left_box.add_child(status_label)
	var right := PanelContainer.new()
	right.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	right.position = Vector2(-318.0, 78.0)
	right.size = Vector2(300.0, 590.0)
	right.mouse_filter = Control.MOUSE_FILTER_STOP
	right.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(right)
	var right_box := VBoxContainer.new()
	right_box.add_theme_constant_override("separation", 6)
	right.add_child(right_box)
	right_box.add_child(_label("INSPECTOR", 20, Color("#edf3d5")))
	selected_label = _label("No module selected", 14, Color("#d3dec5"))
	right_box.add_child(selected_label)
	for axis in ["x", "y", "z"]:
		var row := HBoxContainer.new()
		row.add_child(_label(axis.to_upper(), 14, Color("#9db197")))
		var spinner := SpinBox.new()
		spinner.step = 0.1
		spinner.min_value = -200.0
		spinner.max_value = 200.0
		spinner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(spinner)
		inspector[axis] = spinner
		right_box.add_child(row)
	var apply_transform := _button("APPLY TRANSFORM", 14)
	apply_transform.pressed.connect(_apply_transform)
	right_box.add_child(apply_transform)
	var duplicate := _button("DUPLICATE", 14)
	duplicate.pressed.connect(_duplicate)
	right_box.add_child(duplicate)
	var remove := _button("DELETE", 14)
	remove.pressed.connect(_remove)
	right_box.add_child(remove)
	right_box.add_child(HSeparator.new())
	right_box.add_child(_label("VALIDATION", 18, Color("#edf3d5")))
	report_label = _label("No validation run.", 12, Color("#9db197"))
	report_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	report_label.custom_minimum_size = Vector2(260.0, 160.0)
	right_box.add_child(report_label)
	right_box.add_child(HSeparator.new())
	right_box.add_child(_label("REVISION HISTORY", 18, Color("#edf3d5")))
	history_label = _label("No saved revisions.", 11, Color("#9db197"))
	history_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	right_box.add_child(history_label)
	right_box.add_child(_label("PLAYTEST EVIDENCE", 18, Color("#edf3d5")))
	evidence_label = _label("No completed creative playtest.", 11, Color("#9db197"))
	evidence_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	right_box.add_child(evidence_label)
	var approve := _button("APPROVE ROUTE", 14)
	approve.pressed.connect(_approve_route)
	right_box.add_child(approve)
	var ghost := _button("GHOST REPLAY", 14)
	ghost.pressed.connect(_toggle_ghost)
	right_box.add_child(ghost)
	var heatmap := _button("SHOW HEATMAP", 14)
	heatmap.pressed.connect(_toggle_heatmap)
	right_box.add_child(heatmap)
	root.visible = false

func _refresh_ui() -> void:
	if root == null or document == null:
		return
	for child in module_list.get_children():
		child.queue_free()
	for kind in LEVEL_DOCUMENT.MODULE_KINDS:
		var button := _button(kind.replace("_", " ").to_upper(), 13)
		button.toggle_mode = true
		button.button_pressed = kind == selected_kind
		button.pressed.connect(_choose_module.bind(kind))
		module_list.add_child(button)
	var valid_selection: Array[String] = []
	for module_id in selected_module_ids:
		if not document.module_by_id(module_id).is_empty(): valid_selection.append(module_id)
	if valid_selection.is_empty() and not selected_module_id.is_empty() and not document.module_by_id(selected_module_id).is_empty():
		valid_selection.append(selected_module_id)
	selected_module_ids = valid_selection
	selected_module_id = selected_module_ids[0] if not selected_module_ids.is_empty() else ""
	var selected: Dictionary = document.module_by_id(selected_module_id)
	if selected.is_empty():
		selected_label.text = "No module selected"
		for axis in inspector:
			(inspector[axis] as SpinBox).value = 0.0
	else:
		var selection_prefix := "%d MODULES SELECTED\n" % selected_module_ids.size() if selected_module_ids.size() > 1 else ""
		selected_label.text = selection_prefix + str(selected.get("kind", "")).to_upper() + "\n" + selected_module_id
		var position: Variant = LEVEL_DOCUMENT.vector_from(selected.get("position", [0.0, 0.0, 0.0]))
		(inspector["x"] as SpinBox).value = position.x
		(inspector["y"] as SpinBox).value = position.y
		(inspector["z"] as SpinBox).value = position.z
	_validate(false)
	_refresh_references()
	_refresh_history()
	_refresh_evidence()

func _choose_module(kind: String) -> void:
	authoring_mode = ""
	selected_kind = "" if selected_kind == kind else kind
	_clear_selection()
	_set_status("SELECT A SURFACE TO PLACE " + kind.to_upper())
	_refresh_ui()

func _place(kind: String, point: Vector3) -> void:
	var module := _default_module(kind, point)
	_apply({"action": "add_module", "module": module})
	selected_kind = ""
	_refresh_ui()

func _default_module(kind: String, point: Vector3) -> Dictionary:
	var module := {"id": "", "kind": kind, "route": "Ungrouped", "position": LEVEL_DOCUMENT.vector_data(point)}
	match kind:
		"platform": module["size"] = [5.0, 0.8, 5.0]
		"wall": module["size"] = [0.8, 6.0, 8.0]
		"ramp":
			module["start"] = LEVEL_DOCUMENT.vector_data(point)
			module["end"] = LEVEL_DOCUMENT.vector_data(point + Vector3(0.0, 1.8, -8.0))
			module["width"] = 4.0
		"boost": module["direction"] = [0.0, 0.0, -1.0]
		"recharge": module["tool"] = "dash"
		"gap": module["points"] = 300
		"reset":
			module["spawn"] = LEVEL_DOCUMENT.vector_data(point + Vector3(0.0, 1.1, 0.0))
			module["station"] = "Creative"
		"sign": module["text"] = "CREATIVE"
		"building":
			module["footprint"] = [18.0, 18.0]
			module["height"] = 10.0
		"climbable_trunk":
			module["height"] = 7.0
			module["radius"] = 0.5
		"route_marker": module["label"] = "FLOW"
	return module

func _select_at(point: Vector3) -> void:
	if geometry_root == null:
		return
	var nearest := ""
	var nearest_distance := 2.3
	for node in geometry_root.find_children("*", "Node3D", true, false):
		var module_id := str(node.get_meta("level_module_id", ""))
		if module_id.is_empty():
			continue
		var distance := (node as Node3D).global_position.distance_to(point)
		if distance < nearest_distance:
			nearest = module_id
			nearest_distance = distance
	_set_selected_modules([nearest])
	_set_status("SELECTED " + nearest.to_upper() if not nearest.is_empty() else "NO MODULE SELECTED")
	_refresh_ui()

func _select_at_viewport(viewport_position: Vector2) -> void:
	var nearest := ""
	var nearest_distance := 28.0
	var positions := _module_viewport_positions()
	for module_id in positions:
		var module_position: Vector2 = positions[module_id]
		var distance := viewport_position.distance_to(module_position)
		if distance < nearest_distance:
			nearest = module_id
			nearest_distance = distance
	_set_selected_modules([nearest])
	_set_status("SELECTED " + nearest.to_upper() if not nearest.is_empty() else "NO MODULE SELECTED")
	_refresh_ui()

func _select_in_viewport_rect(viewport_rect: Rect2) -> void:
	var module_ids: Array[String] = []
	var positions := _module_viewport_positions()
	for module_id in positions:
		var module_position: Vector2 = positions[module_id]
		if viewport_rect.has_point(module_position): module_ids.append(module_id)
	_set_selected_modules(module_ids)
	_set_status("SELECTED %d MODULES" % module_ids.size() if not module_ids.is_empty() else "NO MODULE SELECTED")
	_refresh_ui()

func _module_viewport_positions() -> Dictionary:
	var positions := {}
	if geometry_root == null or creative_camera == null:
		return positions
	for node in geometry_root.find_children("*", "Node3D", true, false):
		var module_node := node as Node3D
		var module_id := str(module_node.get_meta("level_module_id", ""))
		if module_id.is_empty() or positions.has(module_id) or creative_camera.is_position_behind(module_node.global_position):
			continue
		positions[module_id] = creative_camera.unproject_position(module_node.global_position)
	return positions

func _set_selected_modules(module_ids: Array[String]) -> void:
	selected_module_ids.clear()
	for module_id in module_ids:
		if module_id.is_empty() or selected_module_ids.has(module_id) or document.module_by_id(module_id).is_empty():
			continue
		selected_module_ids.append(module_id)
	selected_module_id = selected_module_ids[0] if not selected_module_ids.is_empty() else ""

func _clear_selection() -> void:
	selected_module_ids.clear()
	selected_module_id = ""

func _drag_rect() -> Rect2:
	return Rect2(right_drag_start, right_drag_current - right_drag_start).abs()

func _show_selection_box(viewport_rect: Rect2) -> void:
	if selection_box == null:
		return
	selection_box.position = viewport_rect.position
	selection_box.size = viewport_rect.size
	selection_box.visible = true

func _hide_selection_box() -> void:
	if selection_box:
		selection_box.visible = false

func _apply_transform() -> void:
	if selected_module_id.is_empty():
		return
	_apply({"action": "update_module", "module_id": selected_module_id, "patch": {"position": [(inspector["x"] as SpinBox).value, (inspector["y"] as SpinBox).value, (inspector["z"] as SpinBox).value]}})

func _duplicate() -> void:
	if not selected_module_id.is_empty():
		_apply({"action": "duplicate_module", "module_id": selected_module_id})

func _remove() -> void:
	var to_remove := selected_module_ids.duplicate()
	for module_id in to_remove:
		_apply({"action": "remove_module", "module_id": module_id})
	_clear_selection()
	if not to_remove.is_empty():
		_set_status("REMOVED %d MODULES" % to_remove.size())
		_refresh_ui()

func _undo() -> void:
	var result: Dictionary = document.undo()
	if bool(result.get("ok", false)):
		document_changed.emit(result)
	_set_status(str(result.get("error", "UNDO")))
	_refresh_ui()

func _redo() -> void:
	var result: Dictionary = document.redo()
	if bool(result.get("ok", false)):
		document_changed.emit(result)
	_set_status(str(result.get("error", "REDO")))
	_refresh_ui()

func _save_draft() -> bool:
	var result: Dictionary = document.save_draft()
	if not bool(result.get("ok", false)):
		_set_status("CONFLICT: REFRESH DRAFT" if bool(result.get("conflict", false)) else str(result.get("error", "Save failed.")))
		return false
	_set_status("SAVED " + str(result.get("path", document.draft_path())))
	return true

func _refresh_draft() -> void:
	var result: Dictionary = document.refresh_from_draft()
	if bool(result.get("ok", false)):
		document_changed.emit(result)
		_set_status("REFRESHED r" + str(result.get("revision", 0)))
		_refresh_ui()
	else:
		_set_status(str(result.get("error", "Refresh failed.")))

func _publish() -> void:
	var conflict: Dictionary = document.draft_conflict()
	if not bool(conflict.get("ok", false)):
		_set_status("CONFLICT: REFRESH DRAFT")
		return
	var result: Dictionary = document.publish()
	_set_status("PUBLISHED " + str(result.get("path", "")) if bool(result.get("ok", false)) else str(result.get("error", "Publish failed.")))

func _validate(show_status := true) -> void:
	var report: Dictionary = document.validation_report()
	var errors: Array = report.get("errors", [])
	var warnings: Array = report.get("warnings", [])
	report_label.text = "ERRORS %d  WARNINGS %d\n%s" % [errors.size(), warnings.size(), "\n".join(errors + warnings)]
	if show_status:
		_set_status("VALIDATION: %d ERRORS / %d WARNINGS" % [errors.size(), warnings.size()])

func _toggle_view() -> void:
	top_down = not top_down
	_update_camera(true)
	_set_status("TOP-DOWN MAP" if top_down else "FREE-FLY VIEW")

func _playtest() -> void:
	if not _save_draft(): return
	active = false
	root.visible = false
	creative_camera.current = false
	playtest_requested.emit()

func _exit() -> void:
	_save_draft()
	close()
	close_requested.emit()

func _import_reference() -> void:
	var picker := FileDialog.new()
	picker.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	picker.access = FileDialog.ACCESS_FILESYSTEM
	picker.filters = PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp ; Reference images"])
	picker.file_selected.connect(_copy_reference)
	root.add_child(picker)
	picker.popup_centered_ratio(0.7)

func _copy_reference(source_path: String) -> void:
	var extension := source_path.get_extension().to_lower()
	var destination := "res://levels/_drafts/references/reference-" + str(Time.get_ticks_msec()) + "." + extension
	var directory_error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(destination.get_base_dir()))
	if directory_error != OK:
		_set_status("Could not create reference directory.")
		return
	var source := FileAccess.open(source_path, FileAccess.READ)
	var destination_file := FileAccess.open(destination, FileAccess.WRITE)
	if source == null or destination_file == null:
		_set_status("Could not copy reference image.")
		return
	destination_file.store_buffer(source.get_buffer(source.get_length()))
	var reference_id := "reference-" + str((document.data.get("references", []) as Array).size() + 1)
	_apply({"action": "add_reference", "reference": {"id": reference_id, "path": destination, "estimated": true, "position": [0.0, 0.04, -35.0], "size": [20.0, 20.0], "rotation_y": 0.0, "crop": [0.0, 0.0, 1.0, 1.0], "scale_confidence": "estimated"}})
	selected_reference_id = reference_id
	_refresh_references()
	var assumptions: Array = document.data.get("assumptions", [])
	if not assumptions.has("Reference image scale is estimated; confirm a known dimension before publishing."):
		assumptions.append("Reference image scale is estimated; confirm a known dimension before publishing.")
		_apply({"action": "set_metadata", "patch": {"assumptions": assumptions}})
	_set_status("REFERENCE IMPORTED: ESTIMATED SCALE")

func _capture_preview() -> void:
	var path := "res://levels/_drafts/previews/" + str(document.data.get("id", "creative-draft")) + ".png"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var error := image.save_png(ProjectSettings.globalize_path(path))
	_set_status("CAPTURED " + path if error == OK else "Preview capture failed.")

func _apply(transaction: Dictionary) -> void:
	if not transaction.has("expected_revision"):
		transaction["expected_revision"] = int(document.data.get("revision", 0))
	var result: Dictionary = document.apply_transaction(transaction)
	if not bool(result.get("ok", false)):
		_set_status("CONFLICT: REFRESH DRAFT" if bool(result.get("conflict", false)) else str(result.get("error", "Edit failed.")))
		return
	selected_module_id = str(result.get("module_id", selected_module_id))
	document_changed.emit(result)
	_set_status(str(transaction.get("action", "EDIT")).to_upper())
	_refresh_ui()

func _begin_calibration() -> void:
	if _active_reference().is_empty():
		_set_status("IMPORT A TOP-DOWN PLAN FIRST")
		return
	authoring_mode = "calibrate"
	trace_points.clear()
	_set_status("CALIBRATE: CLICK TWO KNOWN PLAN POINTS")

func _begin_wall_trace() -> void:
	if _active_reference().is_empty():
		_set_status("IMPORT AND CALIBRATE A PLAN FIRST")
		return
	authoring_mode = "wall"
	trace_points.clear()
	_set_status("TRACE WALL: CLICK TWO ENDPOINTS")

func _begin_route_trace() -> void:
	if _active_reference().is_empty():
		_set_status("IMPORT AND CALIBRATE A PLAN FIRST")
		return
	authoring_mode = "route"
	trace_points.clear()
	_set_status("TRACE ROUTE: CLICK POINTS, PRESS ENTER TO FINISH")

func _trace_calibration(point: Vector3) -> void:
	trace_points.append(point)
	if trace_points.size() < 2:
		_set_status("CALIBRATE: CLICK SECOND POINT")
		return
	var distance := trace_points[0].distance_to(trace_points[1])
	if distance < 0.01:
		trace_points.clear()
		_set_status("CALIBRATION POINTS MUST DIFFER")
		return
	var reference := _active_reference()
	var factor := float(calibration_distance.value) / distance
	var size: Variant = reference.get("size", [20.0, 20.0])
	var width := float(size[0]) if size is Array and size.size() >= 2 else 20.0
	var height := float(size[1]) if size is Array and size.size() >= 2 else 20.0
	var calibration := {"points": [_reference_local(trace_points[0], reference), _reference_local(trace_points[1], reference)], "distance": float(calibration_distance.value), "world_units_per_reference_unit": factor}
	_apply({"action": "set_metadata", "patch": {"references": _patched_reference(str(reference.get("id", "")), {"size": [width * factor, height * factor], "estimated": false, "scale_confidence": "calibrated", "calibration": calibration}), "assumptions": _without_scale_assumption()}})
	authoring_mode = ""
	trace_points.clear()
	_set_status("PLAN CALIBRATED")

func _trace_wall(point: Vector3) -> void:
	trace_points.append(point)
	if trace_points.size() < 2:
		_set_status("TRACE WALL: CLICK SECOND ENDPOINT")
		return
	var start := trace_points[0]
	var end := trace_points[1]
	var direction := end - start
	var length := Vector2(direction.x, direction.z).length()
	if length >= 0.2:
		var reference := _active_reference()
		var confidence := "calibrated" if str(reference.get("scale_confidence", "estimated")) == "calibrated" else "estimated"
		_apply({"action": "add_module", "module": {"kind": "wall", "route": "Traced Architecture", "position": LEVEL_DOCUMENT.vector_data((start + end) * 0.5 + Vector3(0.0, 3.0, 0.0)), "size": [0.8, 6.0, length], "rotation_y": atan2(direction.x, direction.z), "confidence": confidence, "estimated": confidence != "calibrated", "provenance": {"reference_id": reference.get("id", ""), "trace": "wall", "reference_local_points": [_reference_local(start, reference), _reference_local(end, reference)]}}})
	authoring_mode = ""
	trace_points.clear()
	_set_status("TRACED WALL")

func _trace_route(point: Vector3) -> void:
	trace_points.append(point)
	_set_status("ROUTE POINT %d; ENTER TO FINISH" % trace_points.size())

func _finish_route_trace() -> void:
	if trace_points.size() < 2:
		authoring_mode = ""
		trace_points.clear()
		_set_status("ROUTE NEEDS TWO POINTS")
		return
	var reference := _active_reference()
	var confidence := "calibrated" if str(reference.get("scale_confidence", "estimated")) == "calibrated" else "estimated"
	var route_name := "Traced Route"
	var module_ids: Array = []
	for point in trace_points:
		var module := {"kind": "route_marker", "route": route_name, "position": LEVEL_DOCUMENT.vector_data(point + Vector3(0.0, 0.2, 0.0)), "label": "FLOW", "confidence": confidence, "estimated": confidence != "calibrated", "provenance": {"reference_id": reference.get("id", ""), "trace": "route", "reference_local_points": [_reference_local(point, reference)]}}
		module["id"] = "route-marker-" + str(int(document.data.get("revision", 0)) + module_ids.size() + 1)
		_apply({"action": "add_module", "module": module})
		module_ids.append(str(module["id"]))
	var routes: Array = document.data.get("routes", [])
	routes.append({"id": "traced-route-" + str(int(document.data.get("revision", 0))), "modules": module_ids})
	_apply({"action": "set_metadata", "patch": {"routes": routes}})
	authoring_mode = ""
	trace_points.clear()
	_set_status("TRACED ROUTE")

func _active_reference() -> Dictionary:
	var references: Array = document.data.get("references", [])
	if references.is_empty(): return {}
	if selected_reference_id.is_empty(): selected_reference_id = str(references[references.size() - 1].get("id", ""))
	for reference in references:
		if reference is Dictionary and str(reference.get("id", "")) == selected_reference_id: return reference
	return references[references.size() - 1] if references[references.size() - 1] is Dictionary else {}

func _refresh_references() -> void:
	if reference_picker == null or document == null: return
	reference_picker.clear()
	var references: Array = document.data.get("references", [])
	for index in range(references.size()):
		var reference: Dictionary = references[index] if references[index] is Dictionary else {}
		var reference_id := str(reference.get("id", "reference-" + str(index + 1)))
		reference_picker.add_item(reference_id)
		if reference_id == selected_reference_id: reference_picker.select(index)
	if selected_reference_id.is_empty() and not references.is_empty(): selected_reference_id = str((references[0] as Dictionary).get("id", ""))
	_refresh_reference_fields()

func _select_reference(index: int) -> void:
	if document == null: return
	var references: Array = document.data.get("references", [])
	if index >= 0 and index < references.size() and references[index] is Dictionary:
		selected_reference_id = str((references[index] as Dictionary).get("id", ""))
		_refresh_reference_fields()

func _refresh_reference_fields() -> void:
	if reference_fields.is_empty(): return
	var reference := _active_reference()
	var position: Variant = LEVEL_DOCUMENT.vector_from(reference.get("position", [0.0, 0.0, 0.0]))
	var crop: Variant = reference.get("crop", [0.0, 0.0, 1.0, 1.0])
	var values := {"x": position.x if position != null else 0.0, "z": position.z if position != null else 0.0, "rotation_y": rad_to_deg(float(reference.get("rotation_y", 0.0))), "crop_x": float(crop[0]) if crop is Array and crop.size() == 4 else 0.0, "crop_y": float(crop[1]) if crop is Array and crop.size() == 4 else 0.0, "crop_w": float(crop[2]) if crop is Array and crop.size() == 4 else 1.0, "crop_h": float(crop[3]) if crop is Array and crop.size() == 4 else 1.0}
	for key in reference_fields:
		(reference_fields[key] as SpinBox).value = float(values.get(key, 0.0))

func _apply_reference_transform() -> void:
	var reference := _active_reference()
	if reference.is_empty():
		_set_status("SELECT A REFERENCE")
		return
	var crop_x := clampf(float((reference_fields["crop_x"] as SpinBox).value), 0.0, 0.99)
	var crop_y := clampf(float((reference_fields["crop_y"] as SpinBox).value), 0.0, 0.99)
	var crop_w := clampf(float((reference_fields["crop_w"] as SpinBox).value), 0.01, 1.0 - crop_x)
	var crop_h := clampf(float((reference_fields["crop_h"] as SpinBox).value), 0.01, 1.0 - crop_y)
	var previous: Variant = LEVEL_DOCUMENT.vector_from(reference.get("position", [0.0, 0.04, 0.0]))
	var position: Vector3 = previous if previous != null else Vector3(0.0, 0.04, 0.0)
	position.x = float((reference_fields["x"] as SpinBox).value)
	position.z = float((reference_fields["z"] as SpinBox).value)
	_apply({"action": "set_metadata", "patch": {"references": _patched_reference(str(reference.get("id", "")), {"position": LEVEL_DOCUMENT.vector_data(position), "rotation_y": deg_to_rad(float((reference_fields["rotation_y"] as SpinBox).value)), "crop": [crop_x, crop_y, crop_w, crop_h]})}})
	_set_status("REFERENCE TRANSFORMED")

func _snap_point(point: Vector3) -> Vector3:
	if snap_toggle == null or not snap_toggle.button_pressed: return point
	var step := maxf(float(snap_step.value), 0.01)
	return Vector3(snappedf(point.x, step), point.y, snappedf(point.z, step))

func _reference_local(point: Vector3, reference: Dictionary) -> Array:
	var position: Variant = LEVEL_DOCUMENT.vector_from(reference.get("position", [0.0, 0.0, 0.0]))
	var local: Vector3 = point - (position if position != null else Vector3.ZERO)
	local = local.rotated(Vector3.UP, -float(reference.get("rotation_y", 0.0)))
	var size: Variant = reference.get("size", [20.0, 20.0])
	var width := float(size[0]) if size is Array and size.size() >= 2 else 20.0
	var height := float(size[1]) if size is Array and size.size() >= 2 else 20.0
	return [local.x / width + 0.5, -local.z / height + 0.5]

func _patched_reference(reference_id: String, patch: Dictionary) -> Array:
	var references: Array = document.data.get("references", [])
	var output: Array = []
	for reference in references:
		var next: Dictionary = reference.duplicate(true) if reference is Dictionary else {}
		if str(next.get("id", "")) == reference_id:
			for key in patch: next[key] = patch[key]
		output.append(next)
	return output

func _without_scale_assumption() -> Array:
	var pending_scale := false
	for reference in document.data.get("references", []):
		if reference is Dictionary and str(reference.get("id", "")) != selected_reference_id and str(reference.get("scale_confidence", "estimated")) != "calibrated":
			pending_scale = true
	var output: Array = []
	for assumption in document.data.get("assumptions", []):
		if pending_scale or not str(assumption).begins_with("Reference image scale is estimated"): output.append(assumption)
	return output

func _rollback_previous() -> void:
	var revisions: Array = document.revision_history()
	if revisions.size() < 2:
		_set_status("NO PREVIOUS REVISION")
		return
	var target: Dictionary = revisions[revisions.size() - 2]
	var result: Dictionary = document.rollback_to_revision(int(target.get("revision", -1)), int(document.data.get("revision", 0)))
	if bool(result.get("ok", false)):
		document_changed.emit(result)
		_set_status("ROLLED BACK TO " + str(result.get("rolled_back_to", "")))
		_refresh_ui()
	else:
		_set_status(str(result.get("error", "Rollback failed.")))

func _refresh_history() -> void:
	if history_label == null or document == null: return
	var lines: Array[String] = []
	var revisions: Array = document.revision_history()
	for index in range(maxi(0, revisions.size() - 5), revisions.size()):
		var revision: Dictionary = revisions[index]
		lines.append("r%d %s %s" % [int(revision.get("revision", 0)), str(revision.get("action", "edit")), ",".join(revision.get("changed_module_ids", []))])
	history_label.text = "\n".join(lines) if not lines.is_empty() else "No saved revisions."

func set_playtest_reports(reports: Array) -> void:
	latest_playtest_report = reports[0].duplicate(true) if not reports.is_empty() and reports[0] is Dictionary else {}
	_refresh_evidence()

func _refresh_evidence() -> void:
	if evidence_label == null: return
	if latest_playtest_report.is_empty():
		evidence_label.text = "No completed creative playtest."
		return
	var required := 0
	for module in document.modules():
		if module is Dictionary and str(module.get("kind", "")) == "checkpoint": required += 1
	var reached: Array = latest_playtest_report.get("checkpoints", [])
	var times: Dictionary = latest_playtest_report.get("checkpoint_times", {})
	var timing: Array[String] = []
	for checkpoint_id in reached:
		timing.append(str(checkpoint_id) + " %.1fs" % float(times.get(str(checkpoint_id), 0.0)))
	var missed: Array = latest_playtest_report.get("missed_checkpoints", [])
	evidence_label.text = "r%d  %.1fs  %.1f max\nCHECKPOINTS %d/%d\n%s\nMISSED %s\n%s" % [int(latest_playtest_report.get("revision", -1)), float(latest_playtest_report.get("elapsed", 0.0)), float(latest_playtest_report.get("max_speed", 0.0)), reached.size(), required, " > ".join(timing), ", ".join(missed) if not missed.is_empty() else "NONE", "READY TO APPROVE" if int(latest_playtest_report.get("revision", -1)) == int(document.data.get("revision", 0)) and reached.size() >= required else "CURRENT RUN + ALL CHECKPOINTS REQUIRED"]

func _approve_route() -> void:
	var result: Dictionary = document.approve_with_evidence(latest_playtest_report)
	_set_status("ROUTE APPROVED" if bool(result.get("ok", false)) else str(result.get("error", "Approval failed.")))
	if bool(result.get("ok", false)):
		document_changed.emit(result)
		_refresh_ui()

func _toggle_ghost() -> void:
	if host and not latest_playtest_report.is_empty(): host.call("toggle_playtest_ghost", latest_playtest_report)

func _toggle_heatmap() -> void:
	if host and not latest_playtest_report.is_empty(): host.call("toggle_playtest_heatmap", latest_playtest_report)

func _mouse_plane_point() -> Variant:
	var viewport := get_viewport()
	var origin := creative_camera.project_ray_origin(viewport.get_mouse_position())
	var direction := creative_camera.project_ray_normal(viewport.get_mouse_position())
	if absf(direction.y) < 0.0001:
		return null
	var distance := -origin.y / direction.y
	if distance < 0.0:
		return null
	return origin + direction * distance

func _update_camera(force: bool) -> void:
	if creative_camera == null:
		return
	if top_down:
		creative_rig.global_position = top_focus + Vector3(0.0, top_camera_altitude, 0.0)
		creative_rig.look_at(top_focus, Vector3.FORWARD)
		creative_camera.rotation = Vector3.ZERO
		return
	creative_rig.rotation.y = yaw
	creative_camera.rotation.x = pitch

func _set_status(text: String) -> void:
	if status_label:
		status_label.text = text

func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#07100bee")
	style.border_color = Color("#8ed6ae")
	style.set_border_width_all(1)
	style.content_margin_left = 10.0
	style.content_margin_right = 10.0
	style.content_margin_top = 8.0
	style.content_margin_bottom = 8.0
	return style

func _button(text: String, size: int) -> Button:
	var button := Button.new()
	button.text = text
	button.add_theme_font_size_override("font_size", size)
	button.custom_minimum_size.y = 26.0
	return button

func _label(text: String, size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label
