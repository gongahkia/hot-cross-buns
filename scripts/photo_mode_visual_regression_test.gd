extends SceneTree

const PHOTO_MODE = preload("res://scripts/photo_mode.gd")
var failed := false

func _initialize() -> void:
	var world := Node3D.new()
	root.add_child(world)
	var player := SpeedPlayer.new()
	world.add_child(player)
	var hud := Control.new()
	root.add_child(hud)
	await process_frame
	var environment := Environment.new()
	environment.adjustment_enabled = true
	environment.adjustment_brightness = 0.88
	environment.adjustment_contrast = 1.14
	environment.adjustment_saturation = 0.72
	var photo := PHOTO_MODE.new()
	world.add_child(photo)
	photo.configure(player, hud, Callable(), environment)
	var origin := player.global_position
	photo.toggle()
	_expect(photo.active and not player.movement_enabled and not hud.visible and photo.camera.attributes is CameraAttributesPractical, "photo-mode visual baseline drifted")
	_key(photo, KEY_RIGHT)
	_key(photo, KEY_X)
	_key(photo, KEY_V)
	_key(photo, KEY_F)
	_expect(is_equal_approx(photo.camera.fov, player.camera.fov) and is_equal_approx(photo.photo_attributes.exposure_multiplier, 1.1), "photo exposure baseline drifted")
	_expect(photo.photo_attributes.dof_blur_far_enabled and is_equal_approx(photo.photo_attributes.dof_blur_far_distance, 26.0) and is_equal_approx(photo.photo_attributes.dof_blur_amount, 0.05), "photo depth baseline drifted")
	_expect(environment.adjustment_enabled and is_equal_approx(environment.adjustment_brightness, 0.96) and is_equal_approx(environment.adjustment_saturation, 0.68), "photo filter baseline drifted")
	_key(photo, KEY_F)
	_key(photo, KEY_F)
	_key(photo, KEY_F)
	_expect(is_equal_approx(environment.adjustment_brightness, 0.88) and is_equal_approx(environment.adjustment_contrast, 1.14) and is_equal_approx(environment.adjustment_saturation, 0.72), "photo natural filter restore drifted")
	var wheel := InputEventMouseButton.new()
	wheel.pressed = true
	wheel.button_index = MOUSE_BUTTON_WHEEL_UP
	photo.handle_input(wheel)
	_expect(is_equal_approx(photo.camera.fov, player.camera.fov - 4.0), "photo FOV baseline drifted")
	photo.toggle()
	_expect(not photo.active and player.movement_enabled and hud.visible and player.global_position == origin, "photo-mode exit visual state drifted")
	_expect(environment.adjustment_enabled and is_equal_approx(environment.adjustment_brightness, 0.88) and is_equal_approx(environment.adjustment_contrast, 1.14) and is_equal_approx(environment.adjustment_saturation, 0.72), "photo-mode exit environment restore drifted")
	photo.queue_free()
	world.queue_free()
	hud.queue_free()
	quit(1 if failed else 0)

func _key(photo: PhotoMode, key: Key) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = key
	event.pressed = true
	photo.handle_input(event)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
