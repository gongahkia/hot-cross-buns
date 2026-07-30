class_name SpeedPlayer
extends CharacterBody3D

signal reset_requested
signal traversal_action(action: String, override_points: int)
signal combo_landed
signal hard_landed(injury: float)

const WALK_SPEED := 10.0
const SPRINT_SPEED := 17.0
const SLIDE_SPEED := 19.0
const DASH_SPEED := 22.0
const AIR_MOMENTUM_SPEED := 25.0
const AIR_SOFT_SPEED_CAP := 32.0
const GROUND_ACCELERATION := 46.0
const GROUND_FRICTION := 13.0
const AIR_ACCELERATION := 21.0
const AIR_STRAFE_ACCELERATION := 13.0
const AIR_OVERSPEED_DRAG := 1.6
const JUMP_VELOCITY := 7.6
const GRAVITY := 24.0
const COYOTE_TIME := 0.12
const JUMP_BUFFER_TIME := 0.12
const DOUBLE_JUMP_VELOCITY := 7.0
const WALL_JUMP_GRACE := 0.14
const WALL_JUMP_VELOCITY := 8.4
const WALL_JUMP_SEPARATION_SPEED := 4.5
const WALL_JUMP_MIN_SEPARATION := 1.8
const WALL_JUMP_MAX_SEPARATION := 6.0
const WALL_SLIDE_FALL_SPEED := 3.6
const WALL_RUN_MIN_SPEED := 9.0
const WALL_RUN_MAX_TIME := 1.45
const WALL_RUN_GRAVITY_SCALE := 0.34
const WALL_RUN_ACCELERATION := 15.0
const WALL_RUN_FALL_SPEED := 2.4
const SLAM_SPEED := 38.0
const SLAM_BOUNCE_VELOCITY := 7.4
const SLAM_BOUNCE_BOOST := 7.0
const DASH_TIME := 0.16
const DASH_MAX_SPEED := 34.0
const DASH_DIRECTIONAL_BOOST := 14.0
const GLIDE_SPEED := 15.0
const GLIDE_GRAVITY_SCALE := 0.23
const GLIDE_FALL_SPEED := 4.2
const GLIDE_DIVE_ACCELERATION := 28.0
const GLIDE_LIFT_ACCELERATION := 11.0
const GLIDE_MAX_SPEED := 34.0
const GRAPPLE_RANGE := 29.0
const GRAPPLE_MIN_AIM_DOT := 0.22
const GRAPPLE_RELEASE_DISTANCE := 2.4
const GRAPPLE_MIN_ROPE_LENGTH := 5.0
const GRAPPLE_REEL_SPEED := 5.5
const GRAPPLE_ROPE_STIFFNESS := 52.0
const GRAPPLE_PUMP_ACCELERATION := 18.0
const GRAPPLE_SLINGSHOT_BOOST := 3.0
const SLIDE_ENTRY_BOOST := 2.5
const SLIDE_MIN_SPEED := 4.0
const SLIDE_FRICTION := 1.5
const SLIDE_JUMP_BOOST := 3.0
const LANDING_SLIDE_BOOST := 5.0
const PERFECT_ROLL_WINDOW := 0.18
const RAMP_LAUNCH_MIN_SPEED := 14.0
const RAMP_LAUNCH_SLOPE := 0.16
const RAMP_LAUNCH_COOLDOWN := 0.2
const BASE_CAMERA_FOV := 96.0
const MAX_STRAFE_ROLL := 0.13962634
const SLIDE_STRAFE_ROLL := 0.05235988
const FOV_RESPONSE := 96.0
const SHAKE_DECAY := 0.28
const INJURY_LANDING_SPEED := 12.0
const INJURY_PER_SPEED := 1.5

var camera: Camera3D
var dust_particles: GPUParticles3D
var burst_particles: GPUParticles3D
var yaw := 0.0
var pitch := 0.0
var can_dash := true
var can_double_jump := true
var coyote_timer := 0.0
var jump_buffer := 0.0
var wall_jump_timer := 0.0
var wall_jump_normal := Vector3.ZERO
var wall_jump_collider_id := 0
var last_wall_jump_collider_id := 0
var last_wall_run_collider_id := 0
var dash_timer := 0.0
var is_sliding := false
var is_sprinting := false
var is_slamming := false
var is_gliding := false
var is_grappling := false
var is_wall_sliding := false
var is_wall_running := false
var grapple_anchor: Node3D
var grapple_target := Vector3.ZERO
var grapple_rope_length := 0.0
var wall_run_timer := 0.0
var wall_run_normal := Vector3.ZERO
var roll_window := 0.0
var ramp_launch_cooldown := 0.0
var glide_dive_timer := 0.0
var _slide_latched := false
var movement_enabled := true
var bob_time := 0.0
var current_roll := 0.0
var shake_strength := 0.0
var shake_phase := 0.0
var landing_offset := 0.0
var was_sliding := false
var grapple_line: MeshInstance3D
var grapple_line_mesh: ImmediateMesh
var grapple_line_material: StandardMaterial3D
var airborne_time := 0.0
var flow_timer := 0.0
var survival_speed_multiplier := 1.0

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
	_create_particles()
	_create_grapple_line()

func _unhandled_input(event: InputEvent) -> void:
	if not movement_enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_apply_look(event.relative)

func _apply_look(relative: Vector2) -> void:
	var app_settings := _settings()
	if app_settings == null:
		return
	var sensitivity := float(app_settings.get("mouse_sensitivity"))
	yaw -= relative.x * sensitivity
	var direction := -1.0 if bool(app_settings.get("invert_y")) else 1.0
	pitch = clamp(pitch - relative.y * sensitivity * direction, deg_to_rad(-84.0), deg_to_rad(84.0))
	rotation.y = yaw

func _physics_process(delta: float) -> void:
	if not movement_enabled:
		return
	if Input.is_action_just_pressed("reset_run"):
		reset_requested.emit()
		return
	_roll_timers(delta)
	var input_vector := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var on_floor_before_move := is_on_floor()
	var floor_normal_before_move := get_floor_normal() if on_floor_before_move else Vector3.UP
	if not on_floor_before_move:
		airborne_time += delta
	if on_floor_before_move:
		coyote_timer = COYOTE_TIME
		can_double_jump = true
		can_dash = true
		last_wall_jump_collider_id = 0
		last_wall_run_collider_id = 0
	else:
		coyote_timer = max(coyote_timer - delta, 0.0)
	var tether_toggle := _tether_toggle_enabled()
	if not is_grappling and (Input.is_action_just_pressed("grapple") if tether_toggle else Input.is_action_pressed("grapple")):
		_try_grapple()
	elif is_grappling and tether_toggle and Input.is_action_just_pressed("grapple"):
		_stop_grapple()
	elif is_grappling and not tether_toggle and Input.is_action_just_released("grapple"):
		_stop_grapple(true)
	if is_grappling and Input.is_action_just_pressed("jump"):
		_stop_grapple(true)
	if Input.is_action_just_pressed("jump"):
		jump_buffer = JUMP_BUFFER_TIME
	else:
		jump_buffer = max(jump_buffer - delta, 0.0)
	wall_jump_timer = max(wall_jump_timer - delta, 0.0)
	if jump_buffer > 0.0 and coyote_timer > 0.0:
		if is_sliding:
			_slide_jump()
		else:
			velocity.y = JUMP_VELOCITY
			jump_buffer = 0.0
			coyote_timer = 0.0
			traversal_action.emit("jump", -1)
			_play_sfx("jump")
	elif jump_buffer > 0.0 and wall_jump_timer > 0.0:
		_wall_jump()
	elif jump_buffer > 0.0 and can_double_jump:
		_double_jump()
	if Input.is_action_just_pressed("slam") and not on_floor_before_move:
		_stop_grapple()
		_ground_slam()
	_update_glide_state(on_floor_before_move)
	_handle_slide(on_floor_before_move)
	_handle_sprint(on_floor_before_move)
	if is_sliding and not was_sliding:
		_add_camera_shake(0.018)
		landing_offset = minf(landing_offset, -0.045)
	if not on_floor_before_move:
		var gravity_scale := WALL_RUN_GRAVITY_SCALE if is_wall_running else (GLIDE_GRAVITY_SCALE if is_gliding else 1.0)
		velocity.y -= GRAVITY * gravity_scale * delta
		if is_wall_running:
			velocity.y = maxf(velocity.y, -WALL_RUN_FALL_SPEED)
		if is_gliding:
			velocity.y = maxf(velocity.y, -GLIDE_FALL_SPEED)
	if on_floor_before_move:
		_apply_slope_acceleration(floor_normal_before_move, delta)
	var sprint_dash := _sprint_dash_requested(on_floor_before_move)
	if (Input.is_action_just_pressed("dash") or sprint_dash) and can_dash:
		_stop_grapple()
		_dash("sprint_dash" if sprint_dash else "dash")
	if dash_timer > 0.0:
		dash_timer = max(dash_timer - delta, 0.0)
	else:
		_apply_horizontal_movement(input_vector, on_floor_before_move, delta)
	if is_gliding:
		_apply_glide_swoop(delta)
	if is_grappling:
		_update_grapple(delta, input_vector)
	var impact_velocity := velocity.y
	move_and_slide()
	_cache_wall_contact()
	_update_wall_run(on_floor_before_move)
	_update_wall_slide()
	if is_on_floor():
		can_double_jump = true
		is_gliding = false
		is_wall_sliding = false
		is_wall_running = false
		last_wall_jump_collider_id = 0
	if not on_floor_before_move and is_on_floor():
		if airborne_time >= 0.45:
			traversal_action.emit("airtime", clampi(int(round(airborne_time * 85.0)), 45, 180))
		combo_landed.emit()
		airborne_time = 0.0
	if is_slamming and is_on_floor():
		_slam_bounce()
	elif not on_floor_before_move and is_on_floor() and _try_perfect_land(impact_velocity):
		pass
	elif not on_floor_before_move and is_on_floor() and impact_velocity < -4.0:
		var impact := minf(absf(impact_velocity), 18.0)
		_add_camera_shake(0.012 + impact * 0.0018)
		landing_offset = minf(landing_offset, -impact * 0.006)
		var injury := landing_injury(impact_velocity)
		if injury > 0.0:
			hard_landed.emit(injury)
	if on_floor_before_move and not is_on_floor():
		_try_ramp_launch(floor_normal_before_move)
	was_sliding = is_sliding
	_sample_flow(delta)
	_update_camera_fx(delta, input_vector)
	if global_position.y < -18.0:
		reset_requested.emit()
		return

func _handle_slide(on_floor: bool) -> void:
	var app_settings := _settings()
	var slide_toggle := bool(app_settings.get("slide_toggle")) if app_settings else false
	if Input.is_action_just_pressed("slide"):
		roll_window = PERFECT_ROLL_WINDOW
	if slide_toggle and Input.is_action_just_pressed("slide"):
		_slide_latched = not _slide_latched
	if not slide_toggle:
		_slide_latched = Input.is_action_pressed("slide")
	is_sliding = on_floor and _slide_latched and Vector2(velocity.x, velocity.z).length() > SLIDE_MIN_SPEED
	if is_sliding and not was_sliding:
		var planar := _planar_velocity()
		var direction := planar.normalized() if planar.length() > 0.1 else _forward_direction()
		_set_planar_velocity(direction * minf(planar.length() + SLIDE_ENTRY_BOOST, AIR_SOFT_SPEED_CAP))
		traversal_action.emit("slide", -1)

func _handle_sprint(on_floor: bool) -> void:
	is_sprinting = on_floor and not is_sliding and Input.is_action_pressed("sprint")

func _sprint_dash_requested(on_floor: bool) -> bool:
	return Input.is_action_just_pressed("sprint") and not on_floor

func _movement_top_speed(on_floor: bool) -> float:
	var top_speed := (GLIDE_SPEED if is_gliding else (SLIDE_SPEED if is_sliding else (SPRINT_SPEED if is_sprinting else WALK_SPEED))) * survival_speed_multiplier
	var planar_speed := Vector2(velocity.x, velocity.z).length()
	if is_sprinting:
		top_speed = maxf(top_speed, minf(planar_speed, SLIDE_SPEED * survival_speed_multiplier))
	if not on_floor:
		top_speed = maxf(top_speed, minf(planar_speed, AIR_MOMENTUM_SPEED * survival_speed_multiplier))
	return top_speed

func set_survival_speed_multiplier(multiplier: float) -> void:
	survival_speed_multiplier = clampf(multiplier, 0.0, 1.0)

func survival_movement_state() -> String:
	if is_grappling: return "grapple"
	if is_gliding: return "glide"
	if dash_timer > 0.0: return "dash"
	if is_sliding: return "slide"
	if is_sprinting: return "sprint"
	return "walk"

func traversal_melee_context() -> Dictionary:
	var state := "slam" if is_slamming else "grapple" if is_grappling else "slide" if is_sliding else ""
	if state.is_empty(): return {}
	var planar := _planar_velocity()
	var speed := maxf(planar.length(), absf(velocity.y)) if state == "slam" else planar.length()
	return {"state":state,"speed":speed,"direction":planar.normalized() if planar.length() > 0.001 else _forward_direction(),"origin":global_position+Vector3(0.0,0.8,0.0)}

func survival_exertion_active() -> bool:
	return _planar_velocity().length() > 1.0 or not is_on_floor() or is_sliding or is_sprinting or is_gliding or is_grappling or is_wall_running

static func landing_injury(impact_velocity: float) -> float:
	return clampf((absf(impact_velocity) - INJURY_LANDING_SPEED) * INJURY_PER_SPEED, 0.0, 30.0)

func _update_glide_state(on_floor: bool) -> void:
	is_gliding = not on_floor and not is_grappling and not is_slamming and not is_wall_running and Input.is_action_pressed("glide") and velocity.y <= 1.5

func _roll_timers(delta: float) -> void:
	roll_window = maxf(roll_window - delta, 0.0)
	ramp_launch_cooldown = maxf(ramp_launch_cooldown - delta, 0.0)
	glide_dive_timer = maxf(glide_dive_timer - delta, 0.0)
	if is_wall_running:
		wall_run_timer = maxf(wall_run_timer - delta, 0.0)

func _apply_horizontal_movement(input_vector: Vector2, on_floor: bool, delta: float) -> void:
	var direction := _input_direction(input_vector)
	var planar := _planar_velocity()
	if is_sliding:
		if direction.length() > 0.1:
			var steer := direction * minf(SLIDE_FRICTION * 2.0, planar.length() * 0.12) * delta
			planar += steer
		else:
			planar = planar.move_toward(Vector3.ZERO, SLIDE_FRICTION * delta)
		_set_planar_velocity(_soft_cap_planar(planar, SLIDE_SPEED * survival_speed_multiplier))
		return
	if is_wall_running:
		var tangent := _wall_run_tangent()
		if tangent.length() > 0.1:
			var desired_sign := signf(tangent.dot(direction)) if direction.length() > 0.1 else signf(tangent.dot(planar))
			if is_zero_approx(desired_sign):
				desired_sign = 1.0
			planar = tangent * desired_sign * maxf(planar.length(), WALL_RUN_MIN_SPEED * survival_speed_multiplier)
			planar += tangent * desired_sign * WALL_RUN_ACCELERATION * survival_speed_multiplier * delta
		_set_planar_velocity(_soft_cap_planar(planar, AIR_SOFT_SPEED_CAP * survival_speed_multiplier))
		return
	if on_floor:
		var target := direction * _movement_top_speed(true)
		if direction.length() > 0.1:
			planar = planar.move_toward(target, GROUND_ACCELERATION * delta)
		else:
			planar = planar.move_toward(Vector3.ZERO, GROUND_FRICTION * delta)
		_set_planar_velocity(planar)
		return
	if direction.length() > 0.1:
		var aligned_speed := planar.dot(direction)
		var acceleration := AIR_ACCELERATION if aligned_speed < _movement_top_speed(false) else AIR_STRAFE_ACCELERATION
		planar += direction * acceleration * delta
	_set_planar_velocity(_soft_cap_planar(planar, (GLIDE_MAX_SPEED if is_gliding else AIR_SOFT_SPEED_CAP) * survival_speed_multiplier))

func _apply_slope_acceleration(floor_normal: Vector3, delta: float) -> void:
	var downhill := Vector3.DOWN.slide(floor_normal)
	if downhill.length() < 0.08:
		return
	downhill.y = 0.0
	if downhill.length() < 0.08:
		return
	_set_planar_velocity(_soft_cap_planar(_planar_velocity() + downhill.normalized() * GRAVITY * floor_normal.angle_to(Vector3.UP) * delta, AIR_SOFT_SPEED_CAP))

func _apply_glide_swoop(delta: float) -> void:
	var view_direction := -camera.global_transform.basis.z.normalized()
	var dive_amount := maxf(0.0, -view_direction.y)
	var planar_view := Vector3(view_direction.x, 0.0, view_direction.z).normalized()
	if dive_amount > 0.18 and planar_view.length() > 0.1:
		_set_planar_velocity(_soft_cap_planar(_planar_velocity() + planar_view * GLIDE_DIVE_ACCELERATION * survival_speed_multiplier * dive_amount * delta, GLIDE_MAX_SPEED * survival_speed_multiplier))
		velocity.y -= GRAVITY * dive_amount * 0.45 * delta
		if glide_dive_timer <= 0.0:
			traversal_action.emit("glide_dive", -1)
			glide_dive_timer = 0.65
	elif view_direction.y > 0.25 and _planar_velocity().length() > GLIDE_SPEED:
		velocity.y += GLIDE_LIFT_ACCELERATION * view_direction.y * delta
		_set_planar_velocity(_planar_velocity().move_toward(Vector3.ZERO, GLIDE_LIFT_ACCELERATION * survival_speed_multiplier * view_direction.y * delta))

func _input_direction(input_vector := Input.get_vector("move_left", "move_right", "move_forward", "move_back")) -> Vector3:
	return (transform.basis * Vector3(input_vector.x, 0.0, input_vector.y)).normalized()

func _forward_direction() -> Vector3:
	var forward := -transform.basis.z
	forward.y = 0.0
	return forward.normalized()

func _planar_velocity() -> Vector3:
	return Vector3(velocity.x, 0.0, velocity.z)

func _set_planar_velocity(planar: Vector3) -> void:
	velocity.x = planar.x
	velocity.z = planar.z

func _soft_cap_planar(planar: Vector3, cap: float) -> Vector3:
	var speed := planar.length()
	if speed <= cap:
		return planar
	var excess := speed - cap
	return planar * ((speed - excess * AIR_OVERSPEED_DRAG * 0.0166667) / speed)

func _try_grapple() -> bool:
	if is_grappling:
		_stop_grapple()
		return false
	var best_anchor := grapple_candidate()
	if best_anchor == null:
		return false
	is_grappling = true
	is_gliding = false
	is_wall_sliding = false
	is_wall_running = false
	wall_jump_collider_id = 0
	last_wall_jump_collider_id = 0
	last_wall_run_collider_id = 0
	is_sprinting = false
	is_slamming = false
	grapple_anchor = best_anchor
	grapple_target = best_anchor.global_position
	grapple_rope_length = maxf(GRAPPLE_MIN_ROPE_LENGTH, global_position.distance_to(grapple_target) * 0.82)
	can_dash = true
	can_double_jump = true
	traversal_action.emit("grapple", -1)
	_add_camera_shake(0.028)
	_emit_burst(0.72)
	_play_sfx("dash")
	_refresh_grapple_line()
	return true

func grapple_candidate() -> Node3D:
	if camera == null:
		return null
	var origin := global_position + Vector3(0.0, 1.1, 0.0)
	var view_direction := -camera.global_transform.basis.z.normalized()
	var best_anchor: Node3D
	var best_score := -INF
	for candidate in get_tree().get_nodes_in_group("grapple_anchor"):
		var anchor := candidate as Node3D
		if anchor == null:
			continue
		var offset := anchor.global_position - origin
		var distance := offset.length()
		if distance < 1.0 or distance > GRAPPLE_RANGE:
			continue
		var aim_dot := view_direction.dot(offset / distance)
		if aim_dot < GRAPPLE_MIN_AIM_DOT:
			continue
		var score := aim_dot * 2.0 - distance / GRAPPLE_RANGE
		if score > best_score:
			best_score = score
			best_anchor = anchor
	return best_anchor

func _update_grapple(delta: float, input_vector := Input.get_vector("move_left", "move_right", "move_forward", "move_back")) -> void:
	if grapple_anchor == null or not is_instance_valid(grapple_anchor):
		_stop_grapple()
		return
	grapple_target = grapple_anchor.global_position
	var origin := global_position + Vector3(0.0, 1.1, 0.0)
	var offset := grapple_target - origin
	var distance := offset.length()
	if distance <= GRAPPLE_RELEASE_DISTANCE:
		_stop_grapple()
		return
	var direction := offset / distance
	grapple_rope_length = maxf(GRAPPLE_MIN_ROPE_LENGTH, grapple_rope_length - GRAPPLE_REEL_SPEED * survival_speed_multiplier * delta)
	var radial_speed := velocity.dot(direction)
	if radial_speed > 0.0:
		velocity -= direction * radial_speed
	var tension := maxf(distance - grapple_rope_length, 0.0)
	if tension > 0.0:
		velocity += direction * minf(tension * GRAPPLE_ROPE_STIFFNESS, 42.0) * survival_speed_multiplier * delta
	var pump_direction := _input_direction(input_vector).slide(direction)
	if pump_direction.length() > 0.1:
		velocity += pump_direction.normalized() * GRAPPLE_PUMP_ACCELERATION * survival_speed_multiplier * delta
	_set_planar_velocity(_soft_cap_planar(_planar_velocity(), DASH_MAX_SPEED * survival_speed_multiplier))
	_refresh_grapple_line()

func _stop_grapple(award_release := false) -> void:
	var had_grapple := is_grappling
	var release_speed := Vector2(velocity.x, velocity.z).length()
	if award_release and had_grapple and release_speed >= 12.0:
		var planar := _planar_velocity()
		if planar.length() > 0.1:
			_set_planar_velocity(_soft_cap_planar(planar + planar.normalized() * GRAPPLE_SLINGSHOT_BOOST, DASH_MAX_SPEED))
	is_grappling = false
	grapple_anchor = null
	grapple_rope_length = 0.0
	if grapple_line:
		grapple_line.visible = false
	if grapple_line_mesh:
		grapple_line_mesh.clear_surfaces()
	if award_release and had_grapple and release_speed >= 12.0:
		traversal_action.emit("tether_release", -1)

func tool_status() -> String:
	if is_grappling:
		return "TETHER"
	if is_wall_running:
		return "WALL RUN"
	if is_gliding:
		return "GLIDE"
	if is_wall_sliding:
		return "WALL SLIDE"
	return "E TETHER / F GLIDE"

func style_multiplier_active() -> bool:
	return not is_on_floor() or is_sliding or is_gliding or is_grappling or is_wall_running

func apply_style_feedback(severity: String) -> void:
	var amount := 0.0
	match severity:
		"peak": amount = 0.022
		"major": amount = 0.012
		_: amount = 0.005
	var app_settings := _settings()
	if app_settings and bool(app_settings.get("reduce_screen_effects")):
		amount *= 0.2
	_add_camera_shake(amount)

func _settings() -> Node:
	return get_node_or_null("/root/Settings")

func _tether_toggle_enabled() -> bool:
	var app_settings := _settings()
	return bool(app_settings.get("tether_toggle")) if app_settings else false

func _play_sfx(kind: String) -> void:
	var audio := get_node_or_null("/root/Audio")
	if audio:
		audio.call("play_sfx", kind)

func reset_for_bail(spawn_position: Vector3) -> void:
	global_position = spawn_position
	velocity = Vector3.ZERO
	dash_timer = 0.0
	coyote_timer = 0.0
	jump_buffer = 0.0
	wall_jump_timer = 0.0
	is_sliding = false
	was_sliding = false
	_slide_latched = false
	is_sprinting = false
	is_slamming = false
	is_gliding = false
	is_wall_sliding = false
	is_wall_running = false
	wall_jump_collider_id = 0
	last_wall_jump_collider_id = 0
	can_dash = true
	can_double_jump = true
	airborne_time = 0.0
	flow_timer = 0.0
	roll_window = 0.0
	wall_run_timer = 0.0
	_stop_grapple()

func _dash(style_action := "dash") -> void:
	can_dash = false
	dash_timer = DASH_TIME
	_add_camera_shake(0.038)
	landing_offset = minf(landing_offset, -0.028)
	_emit_burst(0.62)
	_play_sfx("dash")
	var direction := _input_direction()
	if direction.length() < 0.1:
		direction = _forward_direction()
	var planar := _planar_velocity()
	var along_speed := planar.dot(direction)
	var boost := maxf(DASH_DIRECTIONAL_BOOST * survival_speed_multiplier, DASH_SPEED * survival_speed_multiplier - along_speed)
	_set_planar_velocity(_soft_cap_planar(planar + direction * boost, DASH_MAX_SPEED * survival_speed_multiplier))
	var airborne := not is_on_floor()
	if airborne:
		velocity.y = max(velocity.y, 0.0)
	var action := "air_dash" if style_action == "dash" and airborne else style_action
	traversal_action.emit(action, -1)

func apply_boost(direction: Vector3) -> void:
	var planar_direction := Vector3(direction.x, 0.0, direction.z).normalized()
	if planar_direction.length() > 0.1:
		var planar := _planar_velocity()
		var boost := maxf(12.0, 25.0 - planar.dot(planar_direction))
		_set_planar_velocity(_soft_cap_planar(planar + planar_direction * boost, DASH_MAX_SPEED))
	traversal_action.emit("boost", -1)

func launch(force: float) -> void:
	velocity.y = max(velocity.y, force)
	can_dash = true
	can_double_jump = true
	is_slamming = false
	is_gliding = false
	is_sprinting = false
	is_wall_running = false
	traversal_action.emit("launch", -1)
	_add_camera_shake(0.026)

func recharge_air_tool(tool: String) -> void:
	match tool:
		"double_jump": can_double_jump = true
		"both":
			can_dash = true
			can_double_jump = true
		_: can_dash = true
	traversal_action.emit("recharge", -1)
	_emit_burst(0.40)

func _cache_wall_contact() -> void:
	wall_jump_collider_id = 0
	if not is_on_wall():
		return
	for collision_index in range(get_slide_collision_count()):
		var collision := get_slide_collision(collision_index)
		var normal := collision.get_normal()
		if absf(normal.y) > 0.35:
			continue
		var collider := collision.get_collider()
		var collider_id := collider.get_instance_id() if collider else 0
		if collider_id != 0 and collider_id == last_wall_jump_collider_id:
			continue
		wall_jump_normal = normal.normalized()
		wall_jump_collider_id = collider_id
		wall_jump_timer = WALL_JUMP_GRACE
		return
	wall_jump_timer = 0.0

func _wall_jump() -> void:
	if wall_jump_collider_id != 0 and wall_jump_collider_id == last_wall_jump_collider_id:
		wall_jump_timer = 0.0
		return
	velocity.y = WALL_JUMP_VELOCITY
	var outward := Vector3(wall_jump_normal.x, 0.0, wall_jump_normal.z).normalized()
	var planar_velocity := Vector3(velocity.x, 0.0, velocity.z)
	var outward_speed := planar_velocity.dot(outward)
	var target_outward_speed := clampf(outward_speed + WALL_JUMP_SEPARATION_SPEED, WALL_JUMP_MIN_SEPARATION, WALL_JUMP_MAX_SEPARATION)
	planar_velocity += outward * (target_outward_speed - outward_speed)
	velocity.x = planar_velocity.x
	velocity.z = planar_velocity.z
	jump_buffer = 0.0
	coyote_timer = 0.0
	wall_jump_timer = 0.0
	last_wall_jump_collider_id = wall_jump_collider_id
	is_wall_sliding = false
	is_wall_running = false
	can_dash = true
	can_double_jump = true
	traversal_action.emit("wall_jump", -1)
	_add_camera_shake(0.032)
	landing_offset = minf(landing_offset, -0.032)
	_play_sfx("jump")

func _update_wall_slide() -> void:
	_set_wall_slide(is_on_wall(), is_on_floor())

func _set_wall_slide(has_wall_contact: bool, on_floor: bool) -> void:
	is_wall_sliding = has_wall_contact and not on_floor and velocity.y < 0.0 and not is_slamming and not is_gliding and not is_grappling and not is_wall_running
	if is_wall_sliding:
		velocity.y = maxf(velocity.y, -WALL_SLIDE_FALL_SPEED)

func _update_wall_run(on_floor_before_move: bool) -> void:
	if on_floor_before_move or is_on_floor() or is_slamming or is_gliding or is_grappling or wall_jump_collider_id == 0:
		is_wall_running = false
		return
	var planar_speed := _planar_velocity().length()
	var wants_forward_flow := Input.is_action_pressed("move_forward") or planar_speed >= WALL_RUN_MIN_SPEED * 1.35
	if not wants_forward_flow or planar_speed < WALL_RUN_MIN_SPEED or wall_run_timer <= 0.0 and is_wall_running:
		is_wall_running = false
		return
	if not is_wall_running:
		if wall_jump_collider_id == last_wall_run_collider_id:
			return
		is_wall_running = true
		wall_run_timer = WALL_RUN_MAX_TIME
		wall_run_normal = wall_jump_normal
		last_wall_run_collider_id = wall_jump_collider_id
		velocity.y = maxf(velocity.y, -0.6)
		traversal_action.emit("wall_run", -1)
		_add_camera_shake(0.018)
	else:
		wall_run_normal = wall_jump_normal

func _wall_run_tangent() -> Vector3:
	if wall_run_normal.length() < 0.1:
		return Vector3.ZERO
	var tangent := Vector3.UP.cross(wall_run_normal).normalized()
	if tangent.dot(_planar_velocity()) < 0.0:
		tangent = -tangent
	return tangent

func _slide_jump() -> void:
	var planar := _planar_velocity()
	var direction := planar.normalized() if planar.length() > 0.1 else _forward_direction()
	_set_planar_velocity(_soft_cap_planar(planar + direction * SLIDE_JUMP_BOOST, AIR_SOFT_SPEED_CAP))
	velocity.y = JUMP_VELOCITY
	jump_buffer = 0.0
	coyote_timer = 0.0
	is_sliding = false
	_slide_latched = false
	traversal_action.emit("slide_jump", -1)
	_add_camera_shake(0.030)
	_emit_burst(0.18)
	_play_sfx("jump")

func _try_perfect_land(impact_velocity: float) -> bool:
	if roll_window <= 0.0 or impact_velocity > -6.0:
		return false
	var planar := _planar_velocity()
	var direction := planar.normalized() if planar.length() > 0.1 else _forward_direction()
	var recovered_speed := clampf(absf(impact_velocity) * 0.45, 0.0, LANDING_SLIDE_BOOST)
	_set_planar_velocity(_soft_cap_planar(planar + direction * recovered_speed, AIR_SOFT_SPEED_CAP))
	velocity.y = 0.0
	is_sliding = true
	_slide_latched = true
	roll_window = 0.0
	traversal_action.emit("perfect_land", -1)
	_add_camera_shake(0.032)
	_emit_burst(0.10)
	return true

func _try_ramp_launch(floor_normal: Vector3) -> void:
	if ramp_launch_cooldown > 0.0 or _planar_velocity().length() < RAMP_LAUNCH_MIN_SPEED:
		return
	var slope := clampf(floor_normal.angle_to(Vector3.UP) / deg_to_rad(45.0), 0.0, 1.0)
	if slope < 0.18:
		return
	velocity.y = maxf(velocity.y, _planar_velocity().length() * RAMP_LAUNCH_SLOPE * slope)
	ramp_launch_cooldown = RAMP_LAUNCH_COOLDOWN
	traversal_action.emit("ramp_launch", -1)

func _slam_bounce() -> void:
	_add_camera_shake(0.060)
	landing_offset = minf(landing_offset, -0.110)
	_emit_burst(0.10)
	_play_sfx("boost")
	traversal_action.emit("slam_land", -1)
	var planar := _planar_velocity()
	var direction := planar.normalized() if planar.length() > 0.1 else _forward_direction()
	_set_planar_velocity(_soft_cap_planar(planar + direction * SLAM_BOUNCE_BOOST, DASH_MAX_SPEED))
	velocity.y = SLAM_BOUNCE_VELOCITY
	can_dash = true
	can_double_jump = true
	is_slamming = false
	traversal_action.emit("slam_bounce", -1)

func _double_jump() -> void:
	velocity.y = DOUBLE_JUMP_VELOCITY
	jump_buffer = 0.0
	can_double_jump = false
	traversal_action.emit("double_jump", -1)
	_add_camera_shake(0.024)
	landing_offset = minf(landing_offset, -0.018)
	_play_sfx("jump")

func _ground_slam() -> void:
	velocity.y = -SLAM_SPEED
	can_double_jump = false
	is_slamming = true
	is_gliding = false
	is_sprinting = false
	is_wall_running = false
	_add_camera_shake(0.030)
	_emit_burst(0.34)
	_play_sfx("dash")

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
	var target_fov := BASE_CAMERA_FOV + speed_fov + dash_pulse * 11.0 + (5.0 if is_sliding else 0.0) + (3.5 if is_sprinting else 0.0) + (2.5 if is_slamming else 0.0) + (5.0 if is_grappling else 0.0) + (2.5 if is_gliding else 0.0)
	camera.fov = move_toward(camera.fov, target_fov, FOV_RESPONSE * delta)
	_update_particles(speed)

func _add_camera_shake(amount: float) -> void:
	shake_strength = maxf(shake_strength, amount)

func _create_particles() -> void:
	dust_particles = GPUParticles3D.new()
	dust_particles.name = "FootDust"
	dust_particles.position = Vector3(0.0, 0.10, 0.28)
	dust_particles.amount = 48
	dust_particles.lifetime = 0.42
	dust_particles.randomness = 0.32
	dust_particles.local_coords = false
	dust_particles.visibility_aabb = AABB(Vector3(-8.0, -3.0, -8.0), Vector3(16.0, 7.0, 16.0))
	var dust_process := ParticleProcessMaterial.new()
	dust_process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	dust_process.emission_box_extents = Vector3(0.30, 0.04, 0.36)
	dust_process.direction = Vector3(0.0, 1.0, 0.0)
	dust_process.spread = 88.0
	dust_process.gravity = Vector3(0.0, -9.0, 0.0)
	dust_process.initial_velocity_min = 0.45
	dust_process.initial_velocity_max = 1.45
	dust_process.scale_min = 0.11
	dust_process.scale_max = 0.28
	dust_process.color = Color("b9c7989c")
	dust_particles.process_material = dust_process
	dust_particles.draw_pass_1 = _particle_quad(0.24, Color("b9c7989c"))
	dust_particles.emitting = false
	add_child(dust_particles)
	burst_particles = GPUParticles3D.new()
	burst_particles.name = "ActionBurst"
	burst_particles.amount = 36
	burst_particles.lifetime = 0.34
	burst_particles.one_shot = true
	burst_particles.explosiveness = 0.92
	burst_particles.local_coords = false
	burst_particles.visibility_aabb = AABB(Vector3(-9.0, -3.0, -9.0), Vector3(18.0, 9.0, 18.0))
	var burst_process := ParticleProcessMaterial.new()
	burst_process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	burst_process.emission_sphere_radius = 0.24
	burst_process.direction = Vector3(0.0, 1.0, 0.0)
	burst_process.spread = 76.0
	burst_process.gravity = Vector3(0.0, -12.0, 0.0)
	burst_process.initial_velocity_min = 2.8
	burst_process.initial_velocity_max = 6.8
	burst_process.scale_min = 0.08
	burst_process.scale_max = 0.20
	burst_process.color = Color("d8f3b8d9")
	burst_particles.process_material = burst_process
	burst_particles.draw_pass_1 = _particle_quad(0.20, Color("d8f3b8d9"))
	burst_particles.emitting = false
	add_child(burst_particles)

func _create_grapple_line() -> void:
	grapple_line = MeshInstance3D.new()
	grapple_line.name = "GrappleLine"
	grapple_line_mesh = ImmediateMesh.new()
	grapple_line.mesh = grapple_line_mesh
	grapple_line_material = StandardMaterial3D.new()
	grapple_line_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	grapple_line_material.albedo_color = Color("#b9f6df")
	grapple_line_material.emission_enabled = true
	grapple_line_material.emission = Color("#7ee7c0")
	grapple_line_material.emission_energy_multiplier = 2.4
	grapple_line.visible = false
	add_child(grapple_line)

func _refresh_grapple_line() -> void:
	if grapple_line == null or grapple_line_mesh == null or not is_grappling:
		return
	grapple_line_mesh.clear_surfaces()
	grapple_line_mesh.surface_begin(Mesh.PRIMITIVE_LINES, grapple_line_material)
	grapple_line_mesh.surface_add_vertex(Vector3(0.0, 1.1, 0.0))
	grapple_line_mesh.surface_add_vertex(to_local(grapple_target))
	grapple_line_mesh.surface_end()
	grapple_line.visible = true

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
	material.emission_energy_multiplier = 2.0
	quad.material = material
	return quad

func _update_particles(speed: float) -> void:
	if dust_particles == null:
		return
	dust_particles.emitting = is_on_floor() and speed > 3.0
	dust_particles.amount_ratio = clampf((speed - 3.0) / 14.0, 0.18, 1.0)

func _sample_flow(delta: float) -> void:
	var planar_speed := Vector2(velocity.x, velocity.z).length()
	if planar_speed < 15.0 and not is_gliding:
		flow_timer = 0.0
		return
	flow_timer += delta
	if flow_timer < 0.75:
		return
	flow_timer = 0.0
	if is_gliding:
		traversal_action.emit("glide", clampi(int(round(35.0 + planar_speed * 1.5)), 55, 90))
	else:
		traversal_action.emit("speed", clampi(int(round((planar_speed - 10.0) * 8.0)), 35, 90))

func _emit_burst(height: float) -> void:
	if burst_particles == null:
		return
	burst_particles.position = Vector3(0.0, height, 0.26)
	burst_particles.restart()
	burst_particles.emitting = true
