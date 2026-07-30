class_name PhotoMode
extends Node

signal mode_changed(active: bool)
signal captured(path: String, metadata_path: String)

var camera: Camera3D
var subject: SpeedPlayer
var hud: CanvasItem
var metadata_provider: Callable
var active := false
var yaw := 0.0
var pitch := 0.0
var move_speed := 18.0

func configure(next_subject: SpeedPlayer, next_hud: CanvasItem, provider: Callable) -> void:
	subject = next_subject
	hud = next_hud
	metadata_provider = provider

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
	if not active: return false
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * 0.002
		pitch = clampf(pitch - event.relative.y * 0.002, deg_to_rad(-88.0), deg_to_rad(88.0))
		camera.rotation = Vector3(pitch, yaw, 0.0)
		return true
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.fov = maxf(22.0, camera.fov - 4.0)
			return true
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.fov = minf(110.0, camera.fov + 4.0)
			return true
	return false

func _process(delta: float) -> void:
	if not active or camera == null: return
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := camera.global_transform.basis * Vector3(input.x, 0.0, input.y)
	if Input.is_key_pressed(KEY_SPACE): direction += Vector3.UP
	if Input.is_key_pressed(KEY_CTRL): direction += Vector3.DOWN
	var speed := move_speed * (2.5 if Input.is_key_pressed(KEY_SHIFT) else 1.0)
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
	camera.global_transform = subject.camera.global_transform
	camera.fov = subject.camera.fov
	yaw = camera.rotation.y
	pitch = camera.rotation.x
	add_child(camera)
	camera.current = true
	subject.movement_enabled = false
	if hud: hud.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	active = true
	mode_changed.emit(true)

func _exit() -> void:
	if camera:
		camera.queue_free()
		camera = null
	if subject:
		subject.movement_enabled = true
		if subject.camera: subject.camera.current = true
	if hud: hud.visible = true
	active = false
	mode_changed.emit(false)
