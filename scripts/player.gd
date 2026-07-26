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

var camera: Camera3D
var yaw := 0.0
var pitch := 0.0
var can_dash := true
var was_on_floor := false
var coyote_timer := 0.0
var jump_buffer := 0.0
var dash_timer := 0.0
var is_sliding := false
var _slide_latched := false
var movement_enabled := true

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
	camera.fov = 96.0
	add_child(camera)

func _unhandled_input(event: InputEvent) -> void:
	if not movement_enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * Settings.mouse_sensitivity
		var direction := -1.0 if Settings.invert_y else 1.0
		pitch = clamp(pitch - event.relative.y * Settings.mouse_sensitivity * direction, deg_to_rad(-84.0), deg_to_rad(84.0))
		rotation.y = yaw
		camera.rotation.x = pitch

func _physics_process(delta: float) -> void:
	if not movement_enabled:
		return
	if Input.is_action_just_pressed("reset_run"):
		reset_requested.emit()
		return
	var on_floor_before_move := is_on_floor()
	if on_floor_before_move:
		coyote_timer = COYOTE_TIME
		if not was_on_floor:
			can_dash = true
	else:
		coyote_timer = max(coyote_timer - delta, 0.0)
	if Input.is_action_just_pressed("jump"):
		jump_buffer = JUMP_BUFFER_TIME
	else:
		jump_buffer = max(jump_buffer - delta, 0.0)
	if jump_buffer > 0.0 and coyote_timer > 0.0:
		velocity.y = JUMP_VELOCITY
		jump_buffer = 0.0
		coyote_timer = 0.0
	if not on_floor_before_move:
		velocity.y -= GRAVITY * delta
	_handle_slide(on_floor_before_move)
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
	move_and_slide()
	was_on_floor = is_on_floor()
	camera.position.y = move_toward(camera.position.y, 0.88 if is_sliding else 1.45, 8.0 * delta)
	if global_position.y < -18.0:
		reset_requested.emit()
		return
	RunData.record_frame(global_position, rotation.y, camera.rotation.x, is_sliding)

func _handle_slide(on_floor: bool) -> void:
	if Settings.slide_toggle and Input.is_action_just_pressed("slide"):
		_slide_latched = not _slide_latched
	if not Settings.slide_toggle:
		_slide_latched = Input.is_action_pressed("slide")
	is_sliding = on_floor and _slide_latched and Vector2(velocity.x, velocity.z).length() > 2.0

func _dash() -> void:
	can_dash = false
	dash_timer = 0.16
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
