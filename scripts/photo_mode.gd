class_name PhotoMode
extends Node

const CONTROLS := preload("res://scripts/photo_camera_controls.gd")
const VISUALS := preload("res://scripts/photo_visual_controls.gd")

signal mode_changed(active: bool)
signal captured(path: String, metadata_path: String)

var camera: Camera3D
var subject: SpeedPlayer
var hud: CanvasItem
var metadata_provider: Callable
var environment: Environment
var active := false
var yaw := 0.0
var pitch := 0.0
var move_speed := 18.0
var look_sensitivity := 0.002
var entry_transform := Transform3D.IDENTITY
var entry_fov := 75.0
var visual_state: Dictionary = {}
var photo_attributes: CameraAttributesPractical
var original_adjustment: Dictionary = {}

func configure(next_subject: SpeedPlayer, next_hud: CanvasItem, provider: Callable, next_environment: Environment = null) -> void:
	subject = next_subject
	hud = next_hud
	metadata_provider = provider
	environment = next_environment

func toggle() -> void:
	if active:
		_exit()
	else:
		_enter()

func handle_input(event: InputEvent) -> bool:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_P:
			toggle()
			return true
		if active and event.physical_keycode == KEY_F12:
			capture()
			return true
		if active and event.physical_keycode == KEY_R:
			_reset_camera()
			return true
		if active and event.physical_keycode == KEY_MINUS:
			move_speed = CONTROLS.next_speed(move_speed, -1)
			return true
		if active and event.physical_keycode == KEY_EQUAL:
			move_speed = CONTROLS.next_speed(move_speed, 1)
			return true
		if active and event.physical_keycode == KEY_COMMA:
			look_sensitivity = CONTROLS.next_sensitivity(look_sensitivity, -1)
			return true
		if active and event.physical_keycode == KEY_PERIOD:
			look_sensitivity = CONTROLS.next_sensitivity(look_sensitivity, 1)
			return true
		if active and event.physical_keycode == KEY_0:
			visual_state.fov = entry_fov
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_LEFT:
			visual_state.exposure = VISUALS.exposure(float(visual_state.exposure), -1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_RIGHT:
			visual_state.exposure = VISUALS.exposure(float(visual_state.exposure), 1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_Z:
			visual_state.focus_distance = VISUALS.focus_distance(float(visual_state.focus_distance), -1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_X:
			visual_state.focus_distance = VISUALS.focus_distance(float(visual_state.focus_distance), 1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_C:
			visual_state.blur_amount = VISUALS.blur_amount(float(visual_state.blur_amount), -1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_V:
			visual_state.blur_amount = VISUALS.blur_amount(float(visual_state.blur_amount), 1)
			_apply_visuals()
			return true
		if active and event.physical_keycode == KEY_F:
			visual_state.filter_index = VISUALS.next_filter(int(visual_state.filter_index))
			_apply_visuals()
			return true
	if not active: return false
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * look_sensitivity
		pitch = CONTROLS.clamp_pitch(pitch - event.relative.y * look_sensitivity)
		camera.rotation = Vector3(pitch, yaw, 0.0)
		return true
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			visual_state.fov = VISUALS.fov(float(visual_state.fov), -1)
			_apply_visuals()
			return true
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			visual_state.fov = VISUALS.fov(float(visual_state.fov), 1)
			_apply_visuals()
			return true
	return false

func _process(delta: float) -> void:
	if not active or camera == null: return
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var local_direction := CONTROLS.direction(input, Input.is_key_pressed(KEY_SPACE) or Input.is_key_pressed(KEY_Q), Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_E))
	var direction := camera.global_transform.basis * local_direction
	var speed := CONTROLS.speed(move_speed, Input.is_key_pressed(KEY_SHIFT), Input.is_key_pressed(KEY_ALT))
	if direction.length() > 0.01:
		camera.global_position += direction.normalized() * speed * delta

func capture() -> void:
	if not active: return
	var directory := "user://captures"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory))
	var stamp := Time.get_datetime_string_from_system().replace(":", "-").replace("T", "_")
	var base := directory.path_join("a-slow-walk_" + stamp)
	var image := get_viewport().get_texture().get_image()
	var image_path := base + ".png"
	var metadata_path := base + ".json"
	if image.save_png(ProjectSettings.globalize_path(image_path)) != OK: return
	var metadata: Dictionary = metadata_provider.call() if metadata_provider.is_valid() else {}
	metadata["camera"] = {"position": [camera.global_position.x, camera.global_position.y, camera.global_position.z], "fov": camera.fov}
	metadata["captured_at"] = Time.get_datetime_string_from_system(true)
	var file := FileAccess.open(metadata_path, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(metadata, "\t"))
		file.close()
	captured.emit(image_path, metadata_path)

func _enter() -> void:
	if subject == null or subject.camera == null: return
	camera = Camera3D.new()
	camera.name = "PhotoCamera"
	entry_transform = subject.camera.global_transform
	camera.global_transform = entry_transform
	camera.fov = subject.camera.fov
	entry_fov = camera.fov
	visual_state = VISUALS.defaults(entry_fov)
	photo_attributes = CameraAttributesPractical.new()
	camera.attributes = photo_attributes
	_snapshot_environment_adjustment()
	_apply_visuals()
	yaw = camera.rotation.y
	pitch = camera.rotation.x
	add_child(camera)
	camera.current = true
	subject.movement_enabled = false
	if hud: hud.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	active = true
	mode_changed.emit(true)

func _reset_camera() -> void:
	if camera == null: return
	camera.global_transform = entry_transform
	yaw = camera.rotation.y
	pitch = camera.rotation.x

func _apply_visuals() -> void:
	if camera == null or photo_attributes == null: return
	camera.fov = float(visual_state.get("fov", entry_fov))
	photo_attributes.exposure_multiplier = float(visual_state.get("exposure", 1.0))
	photo_attributes.dof_blur_far_enabled = float(visual_state.get("blur_amount", 0.0)) > 0.0
	photo_attributes.dof_blur_far_distance = float(visual_state.get("focus_distance", 24.0))
	photo_attributes.dof_blur_far_transition = 8.0
	photo_attributes.dof_blur_amount = float(visual_state.get("blur_amount", 0.0))
	if environment == null: return
	var filter: Dictionary = VISUALS.filter(int(visual_state.get("filter_index", 0)))
	if int(visual_state.get("filter_index", 0)) == 0:
		_restore_environment_adjustment()
		return
	environment.adjustment_enabled = true
	environment.adjustment_brightness = float(filter.brightness)
	environment.adjustment_contrast = float(filter.contrast)
	environment.adjustment_saturation = float(filter.saturation)

func _snapshot_environment_adjustment() -> void:
	original_adjustment = {}
	if environment == null: return
	original_adjustment = {"enabled":environment.adjustment_enabled,"brightness":environment.adjustment_brightness,"contrast":environment.adjustment_contrast,"saturation":environment.adjustment_saturation}

func _restore_environment_adjustment() -> void:
	if environment == null or original_adjustment.is_empty(): return
	environment.adjustment_enabled = bool(original_adjustment.enabled)
	environment.adjustment_brightness = float(original_adjustment.brightness)
	environment.adjustment_contrast = float(original_adjustment.contrast)
	environment.adjustment_saturation = float(original_adjustment.saturation)

func _exit() -> void:
	_restore_environment_adjustment()
	if camera:
		camera.queue_free()
		camera = null
	if subject:
		subject.movement_enabled = true
		if subject.camera: subject.camera.current = true
	if hud: hud.visible = true
	active = false
	photo_attributes = null
	visual_state = {}
	mode_changed.emit(false)
