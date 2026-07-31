extends SceneTree

const VALIDATOR := preload("res://scripts/world_megastructure_route_validator.gd")
const PLAYER := preload("res://scripts/player.gd")
const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const INTERSECTION := preload("res://scripts/world_megastructure_intersection.gd")

var failed := false

func _initialize() -> void:
	var envelopes := VALIDATOR.envelopes()
	var modes: Array = envelopes.get("modes", [])
	_expect(str(envelopes.get("schema", "")) == VALIDATOR.SCHEMA and str(envelopes.get("unit", "")) == "world_unit" and _mode_ids(modes) == VALIDATOR.MODE_IDS, "route envelope schema drifted")
	for mode: String in VALIDATOR.MODE_IDS:
		_assert_envelope_shape(VALIDATOR.envelope(mode), mode)
	_assert_conservative_limits()
	_assert_baseline_entry_validation()
	_assert_expressive_route_validation()
	_assert_recovery_volume_validation()
	_assert_affordance_visibility_validation()
	var copy := VALIDATOR.envelope("jump")
	copy["max_horizontal"] = 999.0
	_expect(float(VALIDATOR.envelope("jump").get("max_horizontal", 0.0)) == 6.0 and VALIDATOR.envelope("missing").is_empty(), "route envelope isolation drifted")
	_expect(JSON.parse_string(JSON.stringify(envelopes)) is Dictionary, "route envelopes are not JSON serializable")
	quit(1 if failed else 0)

func _mode_ids(modes: Array) -> Array:
	var ids: Array = []
	for record: Dictionary in modes:
		ids.append(str(record.get("id", "")))
	return ids

func _assert_envelope_shape(envelope: Dictionary, mode: String) -> void:
	_expect(str(envelope.get("id", "")) == mode and envelope.has_all(["max_drop", "max_horizontal", "max_rise", "max_slope_degrees", "requires_ground", "unbounded_horizontal"]), "route envelope fields drifted for " + mode)
	for field: String in ["max_drop", "max_horizontal", "max_rise", "max_slope_degrees"]:
		_expect(float(envelope.get(field, -1.0)) >= 0.0, "route envelope has a negative limit for " + mode)

func _assert_conservative_limits() -> void:
	var jump := VALIDATOR.envelope("jump")
	var double_jump := VALIDATOR.envelope("double_jump")
	var dash := VALIDATOR.envelope("dash")
	var wall_run := VALIDATOR.envelope("wall_run")
	var grapple := VALIDATOR.envelope("grapple")
	var glide := VALIDATOR.envelope("glide")
	var drop := VALIDATOR.envelope("drop")
	var jump_peak := PLAYER.JUMP_VELOCITY * PLAYER.JUMP_VELOCITY / (2.0 * PLAYER.GRAVITY)
	var jump_distance := PLAYER.WALK_SPEED * PLAYER.JUMP_VELOCITY * 2.0 / PLAYER.GRAVITY
	var first_peak_time := PLAYER.JUMP_VELOCITY / PLAYER.GRAVITY
	var double_jump_time := first_peak_time + (PLAYER.DOUBLE_JUMP_VELOCITY + sqrt(PLAYER.DOUBLE_JUMP_VELOCITY * PLAYER.DOUBLE_JUMP_VELOCITY + 2.0 * PLAYER.GRAVITY * jump_peak)) / PLAYER.GRAVITY
	var double_jump_peak := jump_peak + PLAYER.DOUBLE_JUMP_VELOCITY * PLAYER.DOUBLE_JUMP_VELOCITY / (2.0 * PLAYER.GRAVITY)
	_expect(float(jump.max_rise) < jump_peak and float(jump.max_horizontal) < jump_distance, "jump envelope exceeds conservative player motion")
	_expect(float(double_jump.max_rise) < double_jump_peak and float(double_jump.max_horizontal) < PLAYER.WALK_SPEED * double_jump_time, "double-jump envelope exceeds conservative player motion")
	_expect(float(dash.max_horizontal) < PLAYER.DASH_SPEED * PLAYER.DASH_TIME and float(wall_run.max_horizontal) < PLAYER.WALL_RUN_MIN_SPEED * PLAYER.WALL_RUN_MAX_TIME + PLAYER.WALL_RUN_ACCELERATION * PLAYER.WALL_RUN_MAX_TIME * PLAYER.WALL_RUN_MAX_TIME * 0.5, "dash or wall-run envelope exceeds conservative player motion")
	_expect(float(grapple.max_anchor_distance) < PLAYER.GRAPPLE_RANGE and float(grapple.max_horizontal) < float(grapple.max_anchor_distance), "grapple envelope exceeds acquisition range")
	_expect(float(glide.max_horizontal) < PLAYER.GLIDE_SPEED * float(glide.max_drop) / PLAYER.GLIDE_FALL_SPEED and float(drop.max_drop) < PLAYER.INJURY_LANDING_SPEED * PLAYER.INJURY_LANDING_SPEED / (2.0 * PLAYER.GRAVITY), "glide or drop envelope exceeds conservative player motion")
	_expect(bool(VALIDATOR.envelope("walk").unbounded_horizontal) and bool(VALIDATOR.envelope("slide").unbounded_horizontal) and not bool(drop.unbounded_horizontal), "ground and drop traversal semantics drifted")

func _assert_baseline_entry_validation() -> void:
	var generator := GENERATOR.new(20260731)
	for cell: Vector3i in [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i.ZERO, Vector3i(4, 0, -2), Vector3i(7, 0, 5)]:
		var validation := VALIDATOR.validate_baseline_entry(generator.generate(cell))
		_expect(str(validation.get("schema", "")) == VALIDATOR.BASELINE_ENTRY_SCHEMA and bool(validation.get("valid", false)) and (validation.get("issues", []) as Array).is_empty(), "generated baseline entry route is invalid")
	var invalid_route := generator.generate(Vector3i.ZERO).duplicate(true)
	(invalid_route.routes[0] as Dictionary)["movement_mode"] = "jump"
	_expect("baseline_route_contract" in VALIDATOR.validate_baseline_entry(invalid_route).get("issues", []), "baseline movement mode regression was accepted")
	var missing_post_threshold := generator.generate(Vector3i.ZERO).duplicate(true)
	(missing_post_threshold.routes[0] as Dictionary)["waypoints"] = []
	_expect("baseline_entry_connectivity" in VALIDATOR.validate_baseline_entry(missing_post_threshold).get("issues", []), "baseline route without post-threshold anchor was accepted")
	var missing_floor := generator.generate(Vector3i.ZERO).duplicate(true)
	(missing_floor.interior as Dictionary)["terrain_mode"] = "terrain"
	_expect("baseline_ground_support" in VALIDATOR.validate_baseline_entry(missing_floor).get("issues", []), "baseline route without floor support was accepted")
	var missed_threshold := generator.generate(Vector3i.ZERO).duplicate(true)
	((missed_threshold.entry as Dictionary).threshold_volume as Dictionary)["min"] = [0, 1000, 0]
	_expect("entry_threshold_not_crossed" in VALIDATOR.validate_baseline_entry(missed_threshold).get("issues", []), "baseline route without threshold crossing was accepted")
	var missed_reveal := generator.generate(Vector3i.ZERO).duplicate(true)
	(missed_reveal.reveals[0] as Dictionary)["recommended_view_anchor"] = [0, 1000, 0]
	_expect("entry_reveal_not_reached" in VALIDATOR.validate_baseline_entry(missed_reveal).get("issues", []), "baseline route without reveal access was accepted")

func _assert_expressive_route_validation() -> void:
	var generator := GENERATOR.new(20260731)
	for cell: Vector3i in [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i.ZERO, Vector3i(4, 0, -2), Vector3i(7, 0, 5)]:
		var validation := VALIDATOR.validate_expressive_route(generator.generate(cell))
		_expect(str(validation.get("schema", "")) == VALIDATOR.EXPRESSIVE_ROUTE_SCHEMA and bool(validation.get("valid", false)) and (validation.get("issues", []) as Array).is_empty(), "generated expressive route is invalid")
	var invalid_ability := generator.generate(Vector3i.ZERO).duplicate(true)
	(invalid_ability.routes[1] as Dictionary)["required_ability"] = "glide"
	_expect("expressive_route_contract" in VALIDATOR.validate_expressive_route(invalid_ability).get("issues", []), "expressive route with wrong ability was accepted")
	var distant_anchor := generator.generate(Vector3i.ZERO).duplicate(true)
	(distant_anchor.routes[1] as Dictionary)["anchor"] = [0, 0, 0]
	_expect("expressive_anchor_out_of_range" in VALIDATOR.validate_expressive_route(distant_anchor).get("issues", []), "expressive route with distant anchor was accepted")
	var long_segment := generator.generate(Vector3i.ZERO).duplicate(true)
	(long_segment.routes[1] as Dictionary)["end_anchor"] = [0, 24, 0]
	_expect("expressive_motion_envelope" in VALIDATOR.validate_expressive_route(long_segment).get("issues", []), "expressive route outside its movement envelope was accepted")
	var descriptor := generator.generate(Vector3i.ZERO)
	var expressive: Dictionary = descriptor.routes[1]
	var launch: Array = expressive.get("start_anchor", [])
	var chunk := Vector2i(floori(float(launch[0]) / 64.0), floori(float(launch[2]) / 64.0))
	var segments: Array = INTERSECTION.compile(descriptor, chunk).get("traversal_segments", [])
	var compiled_anchor: Array = []
	for segment: Dictionary in segments:
		if str(segment.get("route_id", "")) == str(expressive.get("route_id", "")):
			compiled_anchor = segment.get("grapple_anchor", [])
			break
	_expect(compiled_anchor == expressive.get("anchor", []), "expressive route anchor was lost during chunk compilation")

func _assert_recovery_volume_validation() -> void:
	var generator := GENERATOR.new(20260731)
	for cell: Vector3i in [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i.ZERO, Vector3i(4, 0, -2), Vector3i(7, 0, 5)]:
		var validation := VALIDATOR.validate_recovery_volumes(generator.generate(cell))
		_expect(str(validation.get("schema", "")) == VALIDATOR.RECOVERY_VOLUME_SCHEMA and bool(validation.get("valid", false)) and (validation.get("issues", []) as Array).is_empty(), "generated recovery volume is invalid")
	var missing_volume := generator.generate(Vector3i.ZERO).duplicate(true)
	(missing_volume.routes[1] as Dictionary).erase("recovery_volume")
	_expect("recovery_volume_invalid" in VALIDATOR.validate_recovery_volumes(missing_volume).get("issues", []), "required recovery volume was accepted when absent")
	var cramped_volume := generator.generate(Vector3i.ZERO).duplicate(true)
	((cramped_volume.routes[1] as Dictionary).recovery_volume as Dictionary)["min"] = [0, 24, 0]
	((cramped_volume.routes[1] as Dictionary).recovery_volume as Dictionary)["max"] = [1, 25, 1]
	_expect("recovery_landing_missing" in VALIDATOR.validate_recovery_volumes(cramped_volume).get("issues", []), "recovery volume without landing was accepted")

func _assert_affordance_visibility_validation() -> void:
	var generator := GENERATOR.new(20260731)
	for cell: Vector3i in [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i.ZERO, Vector3i(4, 0, -2), Vector3i(7, 0, 5)]:
		var validation := VALIDATOR.validate_affordance_visibility(generator.generate(cell))
		_expect(str(validation.get("schema", "")) == VALIDATOR.AFFORDANCE_VISIBILITY_SCHEMA and bool(validation.get("valid", false)) and (validation.get("issues", []) as Array).is_empty(), "generated affordance visibility is invalid")
	var late_threshold := generator.generate(Vector3i.ZERO).duplicate(true)
	(late_threshold.entry as Dictionary)["threshold_visibility_distance"] = 128
	_expect("threshold_not_visible_before_commit" in VALIDATOR.validate_affordance_visibility(late_threshold).get("issues", []), "late threshold visibility was accepted")
	var close_affordance := generator.generate(Vector3i.ZERO).duplicate(true)
	(close_affordance.routes[1] as Dictionary)["affordance_visibility_distance"] = 20
	_expect("expressive_affordance_too_close" in VALIDATOR.validate_affordance_visibility(close_affordance).get("issues", []), "close expressive affordance was accepted")
	var invalid_commit := generator.generate(Vector3i.ZERO).duplicate(true)
	(invalid_commit.routes[1] as Dictionary)["commit_anchor"] = [0, 24, 0]
	_expect("expressive_commit_anchor_invalid" in VALIDATOR.validate_affordance_visibility(invalid_commit).get("issues", []), "off-route commitment anchor was accepted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
