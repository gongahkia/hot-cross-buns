class_name WorldMegastructureRouteValidator
extends RefCounted

const PLAYER := preload("res://scripts/player.gd")

const SCHEMA := "megastructure-route-envelope/v2"
const BASELINE_ENTRY_SCHEMA := "megastructure-baseline-entry-validation/v1"
const EXPRESSIVE_ROUTE_SCHEMA := "megastructure-expressive-route-validation/v1"
const RECOVERY_VOLUME_SCHEMA := "megastructure-recovery-volume-validation/v1"
const AFFORDANCE_VISIBILITY_SCHEMA := "megastructure-affordance-visibility-validation/v1"
const ROUTE_PRESERVATION_SCHEMA := "megastructure-route-preservation-validation/v1"
const DAMAGE_CONSTRAINT_SCHEMA := "megastructure-damage-constraint-validation/v1"
const HYDROLOGY_CONSTRAINT_SCHEMA := "megastructure-hydrology-constraint-validation/v1"
const ECOLOGY_CONSTRAINT_SCHEMA := "megastructure-ecology-constraint-validation/v1"
const GRAPPLE_ANCHOR_HEIGHT := 12
const RECOVERY_HORIZONTAL_CLEARANCE := 2.0
const RECOVERY_HEADROOM := 2.0
const MIN_THRESHOLD_VISIBILITY_DISTANCE := 64.0
const MIN_EXPRESSIVE_VISIBILITY_DISTANCE := 8.0
const MODE_IDS := ["walk", "jump", "double_jump", "dash", "slide", "wall_run", "grapple", "glide", "drop"]

static func envelopes() -> Dictionary:
	return {"schema":SCHEMA,"unit":"world_unit","modes":[
		_ground("walk", 35.0),
		_air("jump", 6.0, 1.1, 3.0),
		_air("double_jump", 10.0, 2.1, 3.0),
		_air("dash", 3.0, 0.0, 3.0),
		_ground("slide", 25.0),
		_air("wall_run", 24.0, 0.0, 3.0),
		_air("grapple", 20.0, 16.0, 18.0, {"max_anchor_distance":26.0}),
		_air("glide", 60.0, 0.0, 18.0),
		_air("drop", 0.0, 0.0, 2.5),
	]}

static func envelope(mode: String) -> Dictionary:
	for record: Dictionary in envelopes().get("modes", []):
		if str(record.get("id", "")) == mode:
			return record.duplicate(true)
	return {}

static func validate_baseline_entry(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var entry: Dictionary = descriptor.get("entry", {})
	var routes: Array = descriptor.get("routes", [])
	var required_route_ids: Array = entry.get("required_route_ids", [])
	var route_id := ""
	if required_route_ids.size() != 1:
		issues.append("entry_required_route_count")
	else:
		route_id = str(required_route_ids[0])
	var baseline := _route_by_id(routes, route_id)
	if baseline.is_empty():
		issues.append("baseline_route_missing")
		return _validation_result(route_id, issues)
	if str(baseline.get("route_class", "")) != "baseline" or str(baseline.get("movement_mode", "")) != "walk" or not bool(baseline.get("mandatory", false)):
		issues.append("baseline_route_contract")
	var path := _route_path(baseline, issues)
	var approach: Variant = entry.get("approach_anchor", [])
	var post_threshold: Variant = entry.get("post_threshold_anchor", [])
	var first_goal: Variant = entry.get("first_goal_anchor", [])
	if not _is_point(approach) or not _is_point(post_threshold) or not _is_point(first_goal):
		issues.append("entry_anchor_invalid")
	elif path.size() >= 2:
		if path[0] != _point(approach) or path[path.size() - 1] != _point(first_goal) or not path.has(_point(post_threshold)):
			issues.append("baseline_entry_connectivity")
	var interior: Dictionary = descriptor.get("interior", {})
	if str(interior.get("terrain_mode", "")) != "flat_enclosed_floor":
		issues.append("baseline_ground_support")
	else:
		var floor_y := float(interior.get("floor_y", 0))
		for point: Vector3 in path:
			if not is_equal_approx(point.y, floor_y):
				issues.append("baseline_not_on_floor")
				break
	if not _path_intersects_bounds(path, entry.get("threshold_volume", {})):
		issues.append("entry_threshold_not_crossed")
	var reveal := _reveal_by_id(descriptor.get("reveals", []), str(entry.get("initial_reveal_id", "")))
	if reveal.is_empty():
		issues.append("entry_reveal_missing")
	else:
		var reveal_route_ids: Array = reveal.get("required_route_ids", [])
		if not reveal_route_ids.has(route_id):
			issues.append("entry_reveal_route_missing")
		var reveal_anchor: Variant = reveal.get("recommended_view_anchor", [])
		if not _is_point(reveal_anchor) or not _path_contains_point(path, _point(reveal_anchor)):
			issues.append("entry_reveal_not_reached")
	return _validation_result(route_id, issues)

static func validate_expressive_route(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var expressive_routes: Array = []
	for route: Dictionary in descriptor.get("routes", []):
		if str(route.get("route_class", "")) == "expressive":
			expressive_routes.append(route)
	if expressive_routes.size() != 1:
		issues.append("expressive_route_count")
		return _expressive_result("", issues)
	var route: Dictionary = expressive_routes[0]
	var route_id := str(route.get("route_id", ""))
	var mode := str(route.get("movement_mode", ""))
	var envelope := envelope(mode)
	if route_id.is_empty() or bool(route.get("mandatory", false)) or mode != "grapple" or str(route.get("required_ability", "")) != mode or envelope.is_empty():
		issues.append("expressive_route_contract")
	var path := _route_path(route, issues)
	if path.size() != 2:
		issues.append("expressive_route_segment_count")
		return _expressive_result(route_id, issues)
	var anchor: Variant = route.get("anchor", [])
	if not _is_point(anchor):
		issues.append("expressive_anchor_invalid")
		return _expressive_result(route_id, issues)
	var start: Vector3 = path[0]
	var finish: Vector3 = path[1]
	var anchor_point := _point(anchor)
	var horizontal := Vector2(finish.x - start.x, finish.z - start.z).length()
	var rise := maxf(finish.y - start.y, 0.0)
	var drop := maxf(start.y - finish.y, 0.0)
	if horizontal > float(envelope.get("max_horizontal", 0.0)) or rise > float(envelope.get("max_rise", 0.0)) or drop > float(envelope.get("max_drop", 0.0)):
		issues.append("expressive_motion_envelope")
	var max_anchor_distance := float(envelope.get("max_anchor_distance", 0.0))
	if start.distance_to(anchor_point) > max_anchor_distance or finish.distance_to(anchor_point) > max_anchor_distance:
		issues.append("expressive_anchor_out_of_range")
	if anchor_point.y < maxf(start.y, finish.y) + float(GRAPPLE_ANCHOR_HEIGHT):
		issues.append("expressive_anchor_height")
	return _expressive_result(route_id, issues)

static func validate_recovery_volumes(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var required_count := 0
	var interior: Dictionary = descriptor.get("interior", {})
	var floor_y := float(interior.get("floor_y", 0))
	if str(interior.get("terrain_mode", "")) != "flat_enclosed_floor":
		issues.append("recovery_ground_support")
	for route: Dictionary in descriptor.get("routes", []):
		if not bool(route.get("recovery_required", false)):
			continue
		required_count += 1
		var path := _route_path(route, issues)
		if path.size() < 2:
			issues.append("recovery_route_path_invalid")
			continue
		var bounds: Dictionary = route.get("recovery_volume", {})
		if not _valid_bounds(bounds):
			issues.append("recovery_volume_invalid")
			continue
		var minimum := _point(bounds.min)
		var maximum := _point(bounds.max)
		var landing: Vector3 = path[path.size() - 1]
		if not _point_in_bounds(landing, minimum, maximum):
			issues.append("recovery_landing_missing")
		if minimum.x > landing.x - RECOVERY_HORIZONTAL_CLEARANCE or maximum.x < landing.x + RECOVERY_HORIZONTAL_CLEARANCE or minimum.z > landing.z - RECOVERY_HORIZONTAL_CLEARANCE or maximum.z < landing.z + RECOVERY_HORIZONTAL_CLEARANCE:
			issues.append("recovery_landing_clearance")
		if not is_equal_approx(minimum.y, floor_y) or landing.y != floor_y or maximum.y < floor_y + RECOVERY_HEADROOM:
			issues.append("recovery_ground_support")
	if required_count == 0:
		issues.append("recovery_volume_missing")
	return _recovery_result(issues)

static func validate_affordance_visibility(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var entry: Dictionary = descriptor.get("entry", {})
	var approach: Variant = entry.get("approach_anchor", [])
	var threshold: Dictionary = entry.get("threshold_volume", {})
	var threshold_visibility_distance := float(entry.get("threshold_visibility_distance", 0))
	if not _is_point(approach) or not _valid_threshold_bounds(threshold) or threshold_visibility_distance < MIN_THRESHOLD_VISIBILITY_DISTANCE:
		issues.append("threshold_visibility_contract")
	elif _point_to_bounds_distance(_point(approach), _point(threshold.min), _point(threshold.max)) < threshold_visibility_distance:
		issues.append("threshold_not_visible_before_commit")
	var expressive_routes: Array = []
	for route: Dictionary in descriptor.get("routes", []):
		if str(route.get("route_class", "")) == "expressive":
			expressive_routes.append(route)
	if expressive_routes.size() != 1:
		issues.append("expressive_visibility_route_count")
		return _visibility_result(issues)
	var route: Dictionary = expressive_routes[0]
	var path := _route_path(route, issues)
	var commit: Variant = route.get("commit_anchor", [])
	var target: Variant = route.get("anchor", [])
	var required_distance := float(route.get("affordance_visibility_distance", 0))
	if path.size() != 2 or not _is_point(commit) or not _is_point(target) or required_distance < MIN_EXPRESSIVE_VISIBILITY_DISTANCE:
		issues.append("expressive_visibility_contract")
		return _visibility_result(issues)
	var commit_point := _point(commit)
	var target_point := _point(target)
	if commit_point != path[0]:
		issues.append("expressive_commit_anchor_invalid")
	var visible_distance := commit_point.distance_to(target_point)
	if visible_distance < required_distance:
		issues.append("expressive_affordance_too_close")
	var grapple := envelope("grapple")
	if visible_distance > float(grapple.get("max_anchor_distance", 0.0)):
		issues.append("expressive_affordance_out_of_range")
	return _visibility_result(issues)

static func validate_route_preservation(before: Dictionary, after: Dictionary) -> Dictionary:
	var issues: Array = []
	var before_entry: Dictionary = before.get("entry", {})
	var after_entry: Dictionary = after.get("entry", {})
	var required_route_ids: Array = before_entry.get("required_route_ids", [])
	if required_route_ids.is_empty() or required_route_ids != after_entry.get("required_route_ids", []):
		issues.append("mandatory_route_identity_changed")
	for route_id_value: Variant in required_route_ids:
		var route_id := str(route_id_value)
		var before_route := _route_by_id(before.get("routes", []), route_id)
		var after_route := _route_by_id(after.get("routes", []), route_id)
		if before_route.is_empty() or after_route.is_empty():
			issues.append("mandatory_route_missing_after_damage")
			continue
		if not bool(after_route.get("mandatory", false)) or str(before_route.get("movement_mode", "")) != str(after_route.get("movement_mode", "")) or before_route.get("start_anchor", []) != after_route.get("start_anchor", []) or before_route.get("waypoints", []) != after_route.get("waypoints", []) or before_route.get("end_anchor", []) != after_route.get("end_anchor", []):
			issues.append("mandatory_route_changed_after_damage")
	if not bool(validate_baseline_entry(after).get("valid", false)):
		issues.append("baseline_invalid_after_damage")
	if not bool(validate_recovery_volumes(after).get("valid", false)):
		issues.append("recovery_invalid_after_damage")
	if not bool(validate_affordance_visibility(after).get("valid", false)):
		issues.append("visibility_invalid_after_damage")
	return _preservation_result(issues)

static func validate_damage_constraints(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var elements := {}
	for element: Dictionary in descriptor.get("construction_elements", []):
		elements[str(element.get("element_id", ""))] = element
	var baseline := _route_by_id(descriptor.get("routes", []), _required_baseline_id(descriptor.get("entry", {})))
	var baseline_issues: Array = []
	var baseline_path := _route_path(baseline, baseline_issues)
	if baseline.is_empty() or baseline_path.size() < 2:
		issues.append("damage_baseline_missing")
	for damage: Dictionary in descriptor.get("damage", []):
		var target_id := str(damage.get("target_element_id", ""))
		var target: Dictionary = elements.get(target_id, {})
		var bounds: Dictionary = damage.get("bounds", {})
		if target.is_empty() or not _valid_bounds(bounds) or str(damage.get("type", "")) != "constrained_damage" or int(damage.get("epoch_id", 0)) != int(target.get("epoch_id", 0)):
			issues.append("damage_target_invalid")
			continue
		if not (damage.get("affected_route_ids", []) as Array).is_empty():
			issues.append("damage_affects_mandatory_route")
		if _path_intersects_bounds(baseline_path, bounds):
			issues.append("damage_intersects_mandatory_route")
	if (descriptor.get("damage", []) as Array).is_empty():
		issues.append("damage_records_missing")
	return _damage_result(issues)

static func validate_hydrology_constraints(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var damage_by_id := {}
	for damage: Dictionary in descriptor.get("damage", []):
		damage_by_id[str(damage.get("damage_id", ""))] = damage
	var baseline := _route_by_id(descriptor.get("routes", []), _required_baseline_id(descriptor.get("entry", {})))
	var baseline_issues: Array = []
	var baseline_path := _route_path(baseline, baseline_issues)
	for effect: Dictionary in descriptor.get("hydrology", []):
		var source_id := str(effect.get("source_damage_id", ""))
		var source: Dictionary = damage_by_id.get(source_id, {})
		var bounds: Dictionary = effect.get("bounds", {})
		if source.is_empty() or not _valid_bounds(bounds) or str(effect.get("type", "")) != "infrastructure_hydrology" or str(effect.get("source_element_id", "")) != str(source.get("target_element_id", "")):
			issues.append("hydrology_source_invalid")
			continue
		var minimum := _point(bounds.min)
		var maximum := _point(bounds.max)
		var water_level := float(effect.get("water_level", minimum.y - 1.0))
		if water_level < minimum.y or water_level > maximum.y:
			issues.append("hydrology_level_invalid")
		if not (effect.get("affected_route_ids", []) as Array).is_empty() or _path_intersects_bounds(baseline_path, bounds):
			issues.append("hydrology_affects_mandatory_route")
	if (descriptor.get("hydrology", []) as Array).is_empty():
		issues.append("hydrology_records_missing")
	return _hydrology_result(issues)

static func validate_ecology_constraints(descriptor: Dictionary) -> Dictionary:
	var issues: Array = []
	var hydrology_by_id := {}
	var elements_by_id := {}
	var epochs_by_id := {}
	for water: Dictionary in descriptor.get("hydrology", []):
		hydrology_by_id[str(water.get("hydrology_id", ""))] = water
	for element: Dictionary in descriptor.get("construction_elements", []):
		elements_by_id[str(element.get("element_id", ""))] = element
	for epoch: Dictionary in descriptor.get("epochs", []):
		epochs_by_id[int(epoch.get("epoch_id", 0))] = epoch
	var baseline := _route_by_id(descriptor.get("routes", []), _required_baseline_id(descriptor.get("entry", {})))
	var baseline_issues: Array = []
	var baseline_path := _route_path(baseline, baseline_issues)
	for effect: Dictionary in descriptor.get("ecology", []):
		var water: Dictionary = hydrology_by_id.get(str(effect.get("source_hydrology_id", "")), {})
		var element: Dictionary = elements_by_id.get(str(effect.get("source_element_id", "")), {})
		var epoch: Dictionary = epochs_by_id.get(int(element.get("epoch_id", 0)), {})
		var bounds: Dictionary = effect.get("bounds", {})
		if water.is_empty() or element.is_empty() or epoch.is_empty() or str(water.get("source_element_id", "")) != str(element.get("element_id", "")) or str(effect.get("material_family", "")) != str(epoch.get("material_family", "")) or str(effect.get("light_exposure", "")) not in ["breach_daylight", "utility_reflection"] or str(effect.get("exposure", "")) not in ["rain_exposed", "humid_enclosure"] or not _valid_bounds(bounds):
			issues.append("ecology_source_invalid")
			continue
		if not (effect.get("affected_route_ids", []) as Array).is_empty() or _path_intersects_bounds(baseline_path, bounds):
			issues.append("ecology_affects_mandatory_route")
	if (descriptor.get("ecology", []) as Array).is_empty():
		issues.append("ecology_records_missing")
	return _ecology_result(issues)

static func _ground(id: String, max_slope_degrees: float) -> Dictionary:
	return {"id":id,"max_drop":0.0,"max_horizontal":0.0,"max_rise":0.0,"max_slope_degrees":max_slope_degrees,"requires_ground":true,"unbounded_horizontal":true}

static func _air(id: String, max_horizontal: float, max_rise: float, max_drop: float, extras := {}) -> Dictionary:
	var result := {"id":id,"max_drop":max_drop,"max_horizontal":max_horizontal,"max_rise":max_rise,"max_slope_degrees":0.0,"requires_ground":false,"unbounded_horizontal":false}
	for key: String in extras:
		result[key] = extras[key]
	return result

static func _route_by_id(routes: Array, route_id: String) -> Dictionary:
	if route_id.is_empty():
		return {}
	for route: Dictionary in routes:
		if str(route.get("route_id", "")) == route_id:
			return route
	return {}

static func _required_baseline_id(entry: Dictionary) -> String:
	var route_ids: Array = entry.get("required_route_ids", [])
	return str(route_ids[0]) if route_ids.size() == 1 else ""

static func _route_path(route: Dictionary, issues: Array) -> Array:
	var points: Array = [route.get("start_anchor", [])]
	for waypoint in route.get("waypoints", []):
		points.append(waypoint)
	points.append(route.get("end_anchor", []))
	var path: Array = []
	for value: Variant in points:
		if not _is_point(value):
			issues.append("baseline_route_anchor_invalid")
			return []
		path.append(_point(value))
	return path

static func _reveal_by_id(reveals: Array, reveal_id: String) -> Dictionary:
	if reveal_id.is_empty():
		return {}
	for reveal: Dictionary in reveals:
		if str(reveal.get("reveal_id", "")) == reveal_id:
			return reveal
	return {}

static func _is_point(value: Variant) -> bool:
	return value is Array and value.size() == 3

static func _point(value: Array) -> Vector3:
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

static func _path_intersects_bounds(path: Array, bounds: Dictionary) -> bool:
	if path.size() < 2 or not _is_point(bounds.get("min", [])) or not _is_point(bounds.get("max", [])):
		return false
	var minimum := _point(bounds.min)
	var maximum := _point(bounds.max)
	for index in range(path.size() - 1):
		if _segment_intersects_bounds(path[index], path[index + 1], minimum, maximum):
			return true
	return false

static func _valid_bounds(bounds: Dictionary) -> bool:
	if not _is_point(bounds.get("min", [])) or not _is_point(bounds.get("max", [])):
		return false
	var minimum := _point(bounds.min)
	var maximum := _point(bounds.max)
	return minimum.x < maximum.x and minimum.y < maximum.y and minimum.z < maximum.z

static func _valid_threshold_bounds(bounds: Dictionary) -> bool:
	if not _is_point(bounds.get("min", [])) or not _is_point(bounds.get("max", [])):
		return false
	var minimum := _point(bounds.min)
	var maximum := _point(bounds.max)
	return minimum.x <= maximum.x and minimum.y < maximum.y and minimum.z <= maximum.z and (minimum.x < maximum.x or minimum.z < maximum.z)

static func _point_in_bounds(point: Vector3, minimum: Vector3, maximum: Vector3) -> bool:
	return point.x >= minimum.x and point.x <= maximum.x and point.y >= minimum.y and point.y <= maximum.y and point.z >= minimum.z and point.z <= maximum.z

static func _point_to_bounds_distance(point: Vector3, minimum: Vector3, maximum: Vector3) -> float:
	var closest := Vector3(clampf(point.x, minimum.x, maximum.x), clampf(point.y, minimum.y, maximum.y), clampf(point.z, minimum.z, maximum.z))
	return point.distance_to(closest)

static func _segment_intersects_bounds(start: Vector3, finish: Vector3, minimum: Vector3, maximum: Vector3) -> bool:
	var lower := 0.0
	var upper := 1.0
	for axis: Array in [[start.x, finish.x, minimum.x, maximum.x], [start.y, finish.y, minimum.y, maximum.y], [start.z, finish.z, minimum.z, maximum.z]]:
		var origin := float(axis[0])
		var delta := float(axis[1]) - origin
		var low := float(axis[2])
		var high := float(axis[3])
		if is_zero_approx(delta):
			if origin < low or origin > high:
				return false
			continue
		var first := (low - origin) / delta
		var last := (high - origin) / delta
		lower = maxf(lower, minf(first, last))
		upper = minf(upper, maxf(first, last))
		if lower > upper:
			return false
	return true

static func _path_contains_point(path: Array, target: Vector3) -> bool:
	if path.size() < 2:
		return false
	for index in range(path.size() - 1):
		var start: Vector3 = path[index]
		var finish: Vector3 = path[index + 1]
		var segment := finish - start
		var offset := target - start
		if segment.cross(offset).length_squared() <= 0.0001 and offset.dot(target - finish) <= 0.0001:
			return true
	return false

static func _validation_result(route_id: String, issues: Array) -> Dictionary:
	return {"issues":issues,"route_id":route_id,"schema":BASELINE_ENTRY_SCHEMA,"valid":issues.is_empty()}

static func _expressive_result(route_id: String, issues: Array) -> Dictionary:
	return {"issues":issues,"route_id":route_id,"schema":EXPRESSIVE_ROUTE_SCHEMA,"valid":issues.is_empty()}

static func _recovery_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":RECOVERY_VOLUME_SCHEMA,"valid":issues.is_empty()}

static func _visibility_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":AFFORDANCE_VISIBILITY_SCHEMA,"valid":issues.is_empty()}

static func _preservation_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":ROUTE_PRESERVATION_SCHEMA,"valid":issues.is_empty()}

static func _damage_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":DAMAGE_CONSTRAINT_SCHEMA,"valid":issues.is_empty()}

static func _hydrology_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":HYDROLOGY_CONSTRAINT_SCHEMA,"valid":issues.is_empty()}

static func _ecology_result(issues: Array) -> Dictionary:
	return {"issues":issues,"schema":ECOLOGY_CONSTRAINT_SCHEMA,"valid":issues.is_empty()}
