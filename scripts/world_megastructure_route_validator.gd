class_name WorldMegastructureRouteValidator
extends RefCounted

const PLAYER := preload("res://scripts/player.gd")

const SCHEMA := "megastructure-route-envelope/v2"
const BASELINE_ENTRY_SCHEMA := "megastructure-baseline-entry-validation/v1"
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
	var world_bounds: Dictionary = descriptor.get("world_bounds", {})
	for point: Vector3 in path:
		if not _point_in_bounds(point, world_bounds):
			issues.append("baseline_outside_world_bounds")
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

static func _point_in_bounds(point: Vector3, bounds: Dictionary) -> bool:
	if not _is_point(bounds.get("min", [])) or not _is_point(bounds.get("max", [])):
		return false
	var minimum := _point(bounds.min)
	var maximum := _point(bounds.max)
	return point.x >= minimum.x and point.x <= maximum.x and point.y >= minimum.y and point.y <= maximum.y and point.z >= minimum.z and point.z <= maximum.z

static func _path_intersects_bounds(path: Array, bounds: Dictionary) -> bool:
	if path.size() < 2 or not _is_point(bounds.get("min", [])) or not _is_point(bounds.get("max", [])):
		return false
	var minimum := _point(bounds.min)
	var maximum := _point(bounds.max)
	for index in range(path.size() - 1):
		if _segment_intersects_bounds(path[index], path[index + 1], minimum, maximum):
			return true
	return false

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
