class_name WorldMegastructureGenerator
extends RefCounted

const RNG := preload("res://scripts/world_rng.gd")
const HASH := preload("res://scripts/world_megastructure_hash.gd")
const GENERATION_IDENTITY := preload("res://scripts/world_generation_identity.gd")
const ROUTE_VALIDATOR := preload("res://scripts/world_megastructure_route_validator.gd")

const MEGACELL_SIZE := 4096
const DESCRIPTOR_SCHEMA_VERSION := 5
const ARCHETYPE_ID := "ruined_transcontinental_spine"
const ARCHETYPE_VERSION := 1
const GENERATOR_SCHEMA_VERSION := GENERATION_IDENTITY.GENERATOR_SCHEMA_VERSION
const INTERIOR_FLOOR_Y := 24
const INTERIOR_CEILING_Y := 100
const STAGE_AXIS := 3101
const STAGE_WIDTH := 3103
const STAGE_REFUGE := 3107

var world_seed: int
var generator_schema_version: String

func _init(next_world_seed: int, next_generator_schema_version := GENERATOR_SCHEMA_VERSION) -> void:
	world_seed = next_world_seed
	generator_schema_version = next_generator_schema_version

func megacell_at(world_position: Vector3i) -> Vector3i:
	return Vector3i(floori(float(world_position.x) / MEGACELL_SIZE), floori(float(world_position.y) / MEGACELL_SIZE), floori(float(world_position.z) / MEGACELL_SIZE))

func canonical_identity(megacell: Vector3i) -> Dictionary:
	var identity := {
		"archetype_id": ARCHETYPE_ID,
		"archetype_version": ARCHETYPE_VERSION,
		"descriptor_schema_version": DESCRIPTOR_SCHEMA_VERSION,
		"generator_schema_version": generator_schema_version,
		"megacell": _point(megacell),
		"world_seed": str(world_seed),
	}
	identity["structure_id"] = "spine:" + HASH.canonical_hash(identity)
	return identity

func generate(megacell: Vector3i) -> Dictionary:
	var identity := canonical_identity(megacell)
	var axis := _axis(megacell)
	var transverse := Vector3i(-axis.z, 0, axis.x)
	var center := Vector3i(megacell.x * MEGACELL_SIZE + MEGACELL_SIZE / 2, megacell.y * MEGACELL_SIZE + 24, megacell.z * MEGACELL_SIZE + MEGACELL_SIZE / 2)
	var half_width := 112 + _stage_rng(megacell, STAGE_WIDTH).next_range(0, 80)
	var approach := center - axis * 432
	var threshold := center - axis * 320
	var post_threshold := center - axis * 208
	var reveal_anchor := center + axis * 264
	var first_goal := center + axis * 408
	var opening_bounds := _bounds([approach - transverse * half_width, approach + transverse * half_width, first_goal - transverse * half_width, first_goal + transverse * half_width], 20, 92)
	var route_prefix := str(identity.structure_id) + ":opening"
	var reveal := _reveal_descriptor(route_prefix, center, axis, transverse, half_width, reveal_anchor)
	var baseline := _baseline_route(route_prefix, approach, post_threshold, first_goal)
	var shortcut := _grapple_shortcut(route_prefix, post_threshold, first_goal, transverse)
	var survival_detour := _survival_detour(route_prefix, post_threshold, first_goal, transverse, _stage_rng(megacell, STAGE_REFUGE))
	var descriptor := {
		"archetype": {"id": ARCHETYPE_ID, "version": ARCHETYPE_VERSION},
		"entry": {
			"approach_anchor": _point(approach),
			"entry_id": route_prefix + ":entry",
			"entry_type": "elevated_spine_underpass",
			"first_goal_anchor": _point(first_goal),
			"initial_reveal_id": str(reveal.reveal_id),
			"post_threshold_anchor": _point(post_threshold),
			"required_route_ids": [str(baseline.route_id)],
			"structure_id": str(identity.structure_id),
			"threshold_visibility_distance": 96,
			"threshold_volume": _bounds([threshold - transverse * (half_width / 2), threshold + transverse * (half_width / 2)], 0, 52),
			"type": "entry",
		},
		"identity": identity,
		"interior": {
			"ceiling_y": INTERIOR_CEILING_Y,
			"floor_y": INTERIOR_FLOOR_Y,
			"terrain_mode": "flat_enclosed_floor",
			"unit": "world_unit",
		},
		"reveals": [reveal],
		"routes": [baseline, shortcut, survival_detour],
		"sectors": [{
			"bounds": opening_bounds,
			"epoch_ids": [1, 2, 6],
			"function_id": "entry_transit",
			"sector_id": route_prefix + ":sector",
			"structure_id": str(identity.structure_id),
			"type": "sector",
		}],
		"type": "megastructure",
		"world_bounds": opening_bounds,
	}
	descriptor["canonical_hash"] = HASH.canonical_hash(descriptor)
	assert(bool(ROUTE_VALIDATOR.validate_baseline_entry(descriptor).get("valid", false)), "generated megastructure baseline entry route is invalid")
	assert(bool(ROUTE_VALIDATOR.validate_expressive_route(descriptor).get("valid", false)), "generated megastructure expressive route is invalid")
	assert(bool(ROUTE_VALIDATOR.validate_recovery_volumes(descriptor).get("valid", false)), "generated megastructure recovery volumes are invalid")
	assert(bool(ROUTE_VALIDATOR.validate_affordance_visibility(descriptor).get("valid", false)), "generated megastructure affordance visibility is invalid")
	return descriptor

func _axis(megacell: Vector3i) -> Vector3i:
	match _stage_rng(megacell, STAGE_AXIS).next_range(0, 3):
		0:
			return Vector3i(1, 0, 0)
		1:
			return Vector3i(-1, 0, 0)
		2:
			return Vector3i(0, 0, 1)
		_:
			return Vector3i(0, 0, -1)

func _stage_rng(megacell: Vector3i, stage: int) -> WorldRng:
	var coordinate_seed := RNG.thoth_hash(world_seed, megacell.x, megacell.y, megacell.z, stage)
	return RNG.new(RNG.thoth_hash(coordinate_seed, ARCHETYPE_VERSION, DESCRIPTOR_SCHEMA_VERSION, stage))

func _reveal_descriptor(route_prefix: String, center: Vector3i, axis: Vector3i, transverse: Vector3i, half_width: int, reveal_anchor: Vector3i) -> Dictionary:
	var foreground := _bounds([reveal_anchor - axis * 64 - transverse * half_width, reveal_anchor - axis * 64 + transverse * half_width], 0, 76)
	var focus := _bounds([center + axis * 480 - transverse * half_width * 2, center + axis * 480 + transverse * half_width * 2], 0, 312)
	var background := _bounds([center + axis * 1792 - transverse * half_width * 3, center + axis * 1792 + transverse * half_width * 3], 48, 620)
	return {
		"background_bounds": background,
		"focus_bounds": focus,
		"foreground_bounds": foreground,
		"minimum_visibility_distance": 1152,
		"recommended_view_anchor": _point(reveal_anchor),
		"recommended_view_direction": _point(axis),
		"required_route_ids": [route_prefix + ":baseline"],
		"reveal_id": route_prefix + ":first_scale",
		"reveal_type": "transcontinental_spine_continuation",
		"streaming_priority_bias": 1,
		"type": "reveal",
	}

func _baseline_route(route_prefix: String, start: Vector3i, post_threshold: Vector3i, finish: Vector3i) -> Dictionary:
	return _route(route_prefix + ":baseline", "baseline", "walk", start, finish, [post_threshold], true, {})

func _grapple_shortcut(route_prefix: String, start: Vector3i, finish: Vector3i, transverse: Vector3i) -> Dictionary:
	var direction := Vector3i(signi(finish.x - start.x), 0, signi(finish.z - start.z))
	var launch := start + transverse * 18
	var landing := launch + direction * 18
	var anchor := (launch + landing) / 2 + Vector3i(0, ROUTE_VALIDATOR.GRAPPLE_ANCHOR_HEIGHT, 0)
	return _route(route_prefix + ":grapple_shortcut", "expressive", "grapple", launch, landing, [], false, {"affordance_visibility_distance": 12, "anchor": _point(anchor), "commit_anchor": _point(launch), "recovery_required": true, "recovery_volume": _recovery_volume(landing), "required_ability": "grapple"})

func _survival_detour(route_prefix: String, start: Vector3i, finish: Vector3i, transverse: Vector3i, rng: WorldRng) -> Dictionary:
	var side := -1 if rng.next_range(0, 1) == 0 else 1
	var refuge := (start + finish) / 2 + transverse * (side * 72)
	return _route(route_prefix + ":warm_refuge", "survival", "walk", start, finish, [refuge], false, {"exposure_reduction_basis_points": 4500, "shelter_basis_points": 8500, "survival_opportunity": "warm_utility_refuge", "warmth_recovery_basis_points": 1800})

func _route(route_id: String, route_class: String, movement_mode: String, start: Vector3i, finish: Vector3i, waypoints: Array, mandatory: bool, extras: Dictionary) -> Dictionary:
	var route_waypoints: Array = []
	for waypoint: Vector3i in waypoints:
		route_waypoints.append(_point(waypoint))
	var route := {
		"end_anchor": _point(finish),
		"mandatory": mandatory,
		"movement_mode": movement_mode,
		"route_class": route_class,
		"route_id": route_id,
		"sector_id": route_id.rsplit(":", false, 1)[0] + ":sector",
		"start_anchor": _point(start),
		"type": "route",
		"waypoints": route_waypoints,
	}
	for key: String in extras:
		route[key] = extras[key]
	return route

func _recovery_volume(landing: Vector3i) -> Dictionary:
	return _bounds([landing - Vector3i(4, 0, 4), landing + Vector3i(4, 0, 4)], 0, 4)

func _bounds(points: Array, min_y_offset: int, max_y_offset: int) -> Dictionary:
	assert(not points.is_empty(), "bounds need points")
	var minimum: Vector3i = points[0]
	var maximum: Vector3i = points[0]
	for point: Vector3i in points:
		minimum = Vector3i(mini(minimum.x, point.x), mini(minimum.y, point.y), mini(minimum.z, point.z))
		maximum = Vector3i(maxi(maximum.x, point.x), maxi(maximum.y, point.y), maxi(maximum.z, point.z))
	return {"max": _point(maximum + Vector3i(0, max_y_offset, 0)), "min": _point(minimum + Vector3i(0, min_y_offset, 0)), "unit": "world_unit"}

func _point(value: Vector3i) -> Array[int]:
	return [value.x, value.y, value.z]
