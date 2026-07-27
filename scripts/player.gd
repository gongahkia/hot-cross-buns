class_name SpeedPlayer
extends CharacterBody3D

signal reset_requested

const WALK_SPEED := 10.0
const SLIDE_SPEED := 14.0
const DASH_SPEED := 22.0
const JUMP_VELOCITY := 7.6
const GRAVITY := 24.0
const COYOTE_TIME := 0.12
const JUMP_BUFFER_TIME := 0.12
const DOUBLE_JUMP_VELOCITY := 7.0
const WALL_JUMP_GRACE := 0.14
const WALL_JUMP_VELOCITY := 8.4
const WALL_JUMP_PUSH := 13.0
const SLAM_SPEED := 38.0
const DASH_TIME := 0.16
const BASE_CAMERA_FOV := 96.0
const MAX_STRAFE_ROLL := 0.13962634
const SLIDE_STRAFE_ROLL := 0.05235988
const FOV_RESPONSE := 96.0
const SHAKE_DECAY := 0.28

var camera: Camera3D
var yaw := 0.0
var pitch := 0.0
var can_dash := true
var can_double_jump := true
var was_on_floor := false
var coyote_timer := 0.0
var jump_buffer := 0.0
var wall_jump_timer := 0.0
var wall_jump_normal := Vector3.ZERO
var dash_timer := 0.0
var is_sliding := false
var is_slamming := false
var _slide_latched := false
var movement_enabled := true
var bob_time := 0.0
var current_roll := 0.0
var shake_strength := 0.0
var shake_phase := 0.0
var landing_offset := 0.0
var was_sliding := false

func _ready() -> void:
	name = "Player"
	collision_layer = 1
	collision_mask = 1
	var collider := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.36
	shape.height = 1.7
	collider.shape = shape
	collider.position.y = 0.85
	add_child(collider)
	camera = Camera3D.new()
	camera.position.y = 1.45
	camera.current = true
	camera.fov = BASE_CAMERA_FOV
	add_child(camera)

func _unhandled_input(event: InputEvent) -> void:
	if not movement_enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * Settings.mouse_sensitivity
		var direction := -1.0 if Settings.invert_y else 1.0
		pitch = clamp(pitch - event.relative.y * Settings.mouse_sensitivity * direction, deg_to_rad(-84.0), deg_to_rad(84.0))
		rotation.y = yaw

func _physics_process(delta: float) -> void:
	if not movement_enabled:
		return
	if Input.is_action_just_pressed("reset_run"):
		reset_requested.emit()
		return
	var on_floor_before_move := is_on_floor()
	if on_floor_before_move:
		coyote_timer = COYOTE_TIME
		can_double_jump = true
		if not was_on_floor:
			can_dash = true
	else:
		coyote_timer = max(coyote_timer - delta, 0.0)
	if Input.is_action_just_pressed("jump"):
		jump_buffer = JUMP_BUFFER_TIME
	else:
		jump_buffer = max(jump_buffer - delta, 0.0)
	wall_jump_timer = max(wall_jump_timer - delta, 0.0)
	if jump_buffer > 0.0 and coyote_timer > 0.0:
		velocity.y = JUMP_VELOCITY
		jump_buffer = 0.0
		coyote_timer = 0.0
		Audio.play_sfx("jump")
	elif jump_buffer > 0.0 and wall_jump_timer > 0.0:
		_wall_jump()
	elif jump_buffer > 0.0 and can_double_jump:
		_double_jump()
	if Input.is_action_just_pressed("slam") and not on_floor_before_move:
		_ground_slam()
	if not on_floor_before_move:
		velocity.y -= GRAVITY * delta
	_handle_slide(on_floor_before_move)
	if is_sliding and not was_sliding:
		_add_camera_shake(0.018)
		landing_offset = minf(landing_offset, -0.045)
	if Input.is_action_just_pressed("dash") and can_dash:
		_dash()
	var input_vector := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var input_direction := (transform.basis * Vector3(input_vector.x, 0.0, input_vector.y)).normalized()
	var top_speed := SLIDE_SPEED if is_sliding else WALK_SPEED
	if dash_timer > 0.0:
		dash_timer = max(dash_timer - delta, 0.0)
	else:
		var desired := input_direction * top_speed
		var acceleration := 42.0 if on_floor_before_move else 18.0
		velocity.x = move_toward(velocity.x, desired.x, acceleration * delta)
		velocity.z = move_toward(velocity.z, desired.z, acceleration * delta)
	if is_sliding and input_direction.length() < 0.1:
		velocity.x = move_toward(velocity.x, 0.0, 5.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 5.0 * delta)
	var impact_velocity := velocity.y
	move_and_slide()
	_cache_wall_contact()
	if is_on_floor():
		can_double_jump = true
	if is_slamming and is_on_floor():
		_add_camera_shake(0.060)
		landing_offset = minf(landing_offset, -0.110)
		Audio.play_sfx("boost")
		is_slamming = false
	elif not on_floor_before_move and is_on_floor() and impact_velocity < -4.0:
		var impact := minf(absf(impact_velocity), 18.0)
		_add_camera_shake(0.012 + impact * 0.0018)
		landing_offset = minf(landing_offset, -impact * 0.006)
	was_on_floor = is_on_floor()
	was_sliding = is_sliding
	_update_camera_fx(delta, input_vector)
	if global_position.y < -18.0:
		reset_requested.emit()
		return
	RunData.record_frame(global_position, rotation.y, pitch, is_sliding)

func _handle_slide(on_floor: bool) -> void:
	if Settings.slide_toggle and Input.is_action_just_pressed("slide"):
		_slide_latched = not _slide_latched
	if not Settings.slide_toggle:
		_slide_latched = Input.is_action_pressed("slide")
	is_sliding = on_floor and _slide_latched and Vector2(velocity.x, velocity.z).length() > 2.0

func _dash() -> void:
	can_dash = false
	dash_timer = DASH_TIME
	_add_camera_shake(0.038)
	landing_offset = minf(landing_offset, -0.028)
	Audio.play_sfx("dash")
	var direction := -transform.basis.z
	direction.y = 0.0
	direction = direction.normalized()
	velocity.x = direction.x * DASH_SPEED
	velocity.z = direction.z * DASH_SPEED
	if not is_on_floor():
		velocity.y = max(velocity.y, 0.0)

func apply_boost(direction: Vector3) -> void:
	velocity.x = direction.x * 25.0
	velocity.z = direction.z * 25.0

func launch(force: float) -> void:
	velocity.y = max(velocity.y, force)
	can_dash = true
	can_double_jump = true
	is_slamming = false
	_add_camera_shake(0.026)

func _cache_wall_contact() -> void:
	if not is_on_wall():
		return
	var normal := get_wall_normal()
	if absf(normal.y) > 0.35:
		return
	wall_jump_normal = normal.normalized()
	wall_jump_timer = WALL_JUMP_GRACE

func _wall_jump() -> void:
	velocity.y = WALL_JUMP_VELOCITY
	velocity.x = wall_jump_normal.x * WALL_JUMP_PUSH
	velocity.z = wall_jump_normal.z * WALL_JUMP_PUSH
	jump_buffer = 0.0
	coyote_timer = 0.0
	wall_jump_timer = 0.0
	can_dash = true
	can_double_jump = true
	_add_camera_shake(0.032)
	landing_offset = minf(landing_offset, -0.032)
	Audio.play_sfx("jump")

func _double_jump() -> void:
	velocity.y = DOUBLE_JUMP_VELOCITY
	jump_buffer = 0.0
	can_double_jump = false
	_add_camera_shake(0.024)
	landing_offset = minf(landing_offset, -0.018)
	Audio.play_sfx("jump")

func _ground_slam() -> void:
	velocity.y = -SLAM_SPEED
	can_double_jump = false
	is_slamming = true
	_add_camera_shake(0.030)
	Audio.play_sfx("dash")

func _update_camera_fx(delta: float, input_vector: Vector2) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()
	var moving_on_floor := is_on_floor() and speed > 1.0
	if moving_on_floor:
		bob_time += delta * speed * (0.72 if is_sliding else 0.56)
	var bob_amount := 0.052 if is_sliding else 0.027
	var bob_y := sin(bob_time * 2.0) * bob_amount if moving_on_floor else 0.0
	var bob_pitch := sin(bob_time * 2.0) * bob_amount * 0.42 if moving_on_floor else 0.0
	var dash_pulse := 0.0
	if dash_timer > 0.0:
		dash_pulse = sin((1.0 - dash_timer / DASH_TIME) * PI)
	var target_roll := -input_vector.x * MAX_STRAFE_ROLL
	if is_sliding:
		target_roll -= input_vector.x * SLIDE_STRAFE_ROLL
	target_roll += sin(bob_time) * bob_amount * 0.24
	current_roll = move_toward(current_roll, target_roll, 1.35 * delta)
	shake_phase += delta * 74.0
	shake_strength = move_toward(shake_strength, 0.0, SHAKE_DECAY * delta)
	landing_offset = move_toward(landing_offset, 0.0, 4.2 * delta)
	var shake_x := sin(shake_phase * 1.71) * shake_strength
	var shake_y := cos(shake_phase * 2.23) * shake_strength
	var shake_roll := sin(shake_phase * 1.19) * shake_strength
	var eye_height := 0.88 if is_sliding else 1.45
	var target_position := Vector3(shake_x * 0.16, eye_height + bob_y + landing_offset + shake_y * 0.22, shake_y * 0.12)
	camera.position = camera.position.lerp(target_position, minf(delta * 16.0, 1.0))
	camera.rotation = Vector3(pitch + bob_pitch + shake_y * 0.34, 0.0, current_roll + shake_roll)
	var speed_fov := clampf(speed / DASH_SPEED, 0.0, 1.0) * 4.0
	var target_fov := BASE_CAMERA_FOV + speed_fov + dash_pulse * 11.0 + (5.0 if is_sliding else 0.0) + (2.5 if is_slamming else 0.0)
	camera.fov = move_toward(camera.fov, target_fov, FOV_RESPONSE * delta)

func _add_camera_shake(amount: float) -> void:
	shake_strength = maxf(shake_strength, amount)
