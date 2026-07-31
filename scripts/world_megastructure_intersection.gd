class_name WorldMegastructureIntersection
extends RefCounted

const HASH := preload("res://scripts/world_megastructure_hash.gd")

const SCHEMA := "megastructure-intersection/v1"
const CHUNK_SIZE := 64
const POINT_SCALE := 1024

static func compile(descriptor: Dictionary, chunk: Vector2i) -> Dictionary:
	var macro_bounds := _macro_bounds(descriptor)
	var result := {
		"chunk": _chunk_point(chunk),
		"interior": (descriptor.get("interior", {}) as Dictionary).duplicate(true),
		"macro": _clip_to_chunk(macro_bounds, chunk),
		"schema": SCHEMA,
		"sectors": [],
		"structure_id": str((descriptor.get("identity", {}) as Dictionary).get("structure_id", "")),
		"structural_ports": [],
		"traversal_segments": [],
		"traversal_ports": [],
	}
	for sector: Dictionary in descriptor.get("sectors", []):
		var clipped := _clip_to_chunk(sector.get("bounds", {}), chunk)
		if not clipped.is_empty():
			(result.sectors as Array).append({"bounds": clipped, "sector_id": str(sector.get("sector_id", ""))})
	if not (result.macro as Dictionary).is_empty():
		result.structural_ports = _structural_ports(descriptor, macro_bounds, chunk)
	result.traversal_segments = _traversal_segments(descriptor, chunk)
	result.traversal_ports = _traversal_ports(descriptor, chunk)
	return result

static func canonical_boundary_key(descriptor: Dictionary, first: Vector2i, second: Vector2i, layer: String) -> String:
	if abs(first.x - second.x) + abs(first.y - second.y) != 1 or layer.is_empty():
		return ""
	var ordered := _ordered_chunks(first, second)
	var identity: Dictionary = descriptor.get("identity", {})
	var payload := {
		"archetype_id": str(identity.get("archetype_id", "")),
		"archetype_version": int(identity.get("archetype_version", 0)),
		"chunks": [_chunk_point(ordered[0]), _chunk_point(ordered[1])],
		"descriptor_schema_version": int(identity.get("descriptor_schema_version", 0)),
		"generator_schema_version": str(identity.get("generator_schema_version", "")),
		"layer": layer,
		"megacell": identity.get("megacell", []),
		"schema": "megastructure-boundary/v1",
		"world_seed": str(identity.get("world_seed", "")),
	}
	return "mega-boundary:" + HASH.canonical_hash(payload)

static func _macro_bounds(descriptor: Dictionary) -> Dictionary:
	var bounds: Dictionary = descriptor.get("world_bounds", {})
	for reveal: Dictionary in descriptor.get("reveals", []):
		bounds = _merge_bounds(bounds, reveal.get("background_bounds", {}))
	return bounds

static func _structural_ports(descriptor: Dictionary, macro_bounds: Dictionary, chunk: Vector2i) -> Array:
	var ports: Array = []
	for offset: Vector2i in [Vector2i(-1, 0), Vector2i(0, -1), Vector2i(0, 1), Vector2i(1, 0)]:
		var neighbor := chunk + offset
		if _clip_to_chunk(macro_bounds, neighbor).is_empty():
			continue
		var ordered := _ordered_chunks(chunk, neighbor)
		var axis := "x" if chunk.x != neighbor.x else "z"
		var point := _structural_point(macro_bounds, ordered[0], ordered[1], axis)
		ports.append({
			"boundary_axis": axis,
			"chunks": [_chunk_point(ordered[0]), _chunk_point(ordered[1])],
			"contract_key": canonical_boundary_key(descriptor, ordered[0], ordered[1], "structure"),
			"owner_chunk": _chunk_point(ordered[0]),
			"point_fp": _point_fp(point),
			"port_type": "structural",
		})
	ports.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return str(left.contract_key) < str(right.contract_key))
	return ports

static func _traversal_ports(descriptor: Dictionary, chunk: Vector2i) -> Array:
	var ports: Array = []
	for route: Dictionary in descriptor.get("routes", []):
		var points := [_point(route.get("start_anchor", []))]
		for waypoint in route.get("waypoints", []):
			points.append(_point(waypoint))
		points.append(_point(route.get("end_anchor", [])))
		for index in range(points.size() - 1):
			for crossing: Dictionary in _segment_crossings(points[index], points[index + 1]):
				var chunks: Array = crossing.chunks
				if chunk != chunks[0] and chunk != chunks[1]:
					continue
				ports.append({
					"boundary_axis": str(crossing.boundary_axis),
					"chunks": [_chunk_point(chunks[0]), _chunk_point(chunks[1])],
					"contract_key": canonical_boundary_key(descriptor, chunks[0], chunks[1], "traversal/" + str(route.get("route_id", ""))),
					"mandatory": bool(route.get("mandatory", false)),
					"owner_chunk": _chunk_point(chunks[0]),
					"point_fp": _point_fp(crossing.point),
					"port_type": "traversal",
					"route_class": str(route.get("route_class", "")),
					"route_id": str(route.get("route_id", "")),
				})
	ports.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return str(left.contract_key) < str(right.contract_key))
	return ports

static func _traversal_segments(descriptor: Dictionary, chunk: Vector2i) -> Array:
	var segments: Array = []
	for route: Dictionary in descriptor.get("routes", []):
		var points := [_point(route.get("start_anchor", []))]
		for waypoint in route.get("waypoints", []):
			points.append(_point(waypoint))
		points.append(_point(route.get("end_anchor", [])))
		for index in range(points.size() - 1):
			var clipped := _clip_segment_to_chunk(points[index], points[index + 1], chunk)
			if clipped.is_empty():
				continue
			var segment := {
				"end_fp": _point_fp(clipped.end),
				"id": str(route.get("route_id", "")) + ":segment:%d" % index,
				"mandatory": bool(route.get("mandatory", false)),
				"movement_mode": str(route.get("movement_mode", "")),
				"route_class": str(route.get("route_class", "")),
				"route_id": str(route.get("route_id", "")),
				"start_fp": _point_fp(clipped.start),
			}
			if str(route.get("movement_mode", "")) == "grapple" and index == 0 and route.get("anchor", []) is Array:
				segment["grapple_anchor"] = (route.get("anchor", []) as Array).duplicate(true)
			segments.append(segment)
	segments.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return str(left.id) < str(right.id))
	return segments

static func _clip_segment_to_chunk(start: Vector3, finish: Vector3, chunk: Vector2i) -> Dictionary:
	var minimum_x := float(chunk.x * CHUNK_SIZE)
	var minimum_z := float(chunk.y * CHUNK_SIZE)
	var maximum_x := minimum_x + CHUNK_SIZE
	var maximum_z := minimum_z + CHUNK_SIZE
	var delta := finish - start
	var lower := 0.0
	var upper := 1.0
	for edge: Array in [[-delta.x, start.x - minimum_x], [delta.x, maximum_x - start.x], [-delta.z, start.z - minimum_z], [delta.z, maximum_z - start.z]]:
		var p := float(edge[0])
		var q := float(edge[1])
		if is_zero_approx(p):
			if q < 0.0:
				return {}
			continue
		var ratio := q / p
		if p < 0.0:
			lower = maxf(lower, ratio)
		else:
			upper = minf(upper, ratio)
		if lower > upper:
			return {}
	if is_equal_approx(lower, upper):
		return {}
	return {"end": start.lerp(finish, upper), "start": start.lerp(finish, lower)}

static func _segment_crossings(start: Vector3, finish: Vector3) -> Array:
	var crossings: Array = []
	var delta := finish - start
	if not is_zero_approx(delta.x):
		var first_x := floori(minf(start.x, finish.x) / float(CHUNK_SIZE)) + 1
		var last_x := floori((maxf(start.x, finish.x) - 0.0001) / float(CHUNK_SIZE))
		for cell_x in range(first_x, last_x + 1):
			var x := float(cell_x * CHUNK_SIZE)
			var t := (x - start.x) / delta.x
			if t <= 0.0 or t >= 1.0:
				continue
			var point := start.lerp(finish, t)
			var z_chunk := floori(point.z / float(CHUNK_SIZE))
			var ordered := _ordered_chunks(Vector2i(cell_x - 1, z_chunk), Vector2i(cell_x, z_chunk))
			crossings.append({"boundary_axis": "x", "chunks": ordered, "point": point, "sort_t": t})
	if not is_zero_approx(delta.z):
		var first_z := floori(minf(start.z, finish.z) / float(CHUNK_SIZE)) + 1
		var last_z := floori((maxf(start.z, finish.z) - 0.0001) / float(CHUNK_SIZE))
		for cell_z in range(first_z, last_z + 1):
			var z := float(cell_z * CHUNK_SIZE)
			var t := (z - start.z) / delta.z
			if t <= 0.0 or t >= 1.0:
				continue
			var point := start.lerp(finish, t)
			var x_chunk := floori(point.x / float(CHUNK_SIZE))
			var ordered := _ordered_chunks(Vector2i(x_chunk, cell_z - 1), Vector2i(x_chunk, cell_z))
			crossings.append({"boundary_axis": "z", "chunks": ordered, "point": point, "sort_t": t})
	crossings.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return float(left.sort_t) < float(right.sort_t) if not is_equal_approx(float(left.sort_t), float(right.sort_t)) else str(left.boundary_axis) < str(right.boundary_axis))
	return crossings

static func _clip_to_chunk(bounds: Dictionary, chunk: Vector2i) -> Dictionary:
	var minimum := _point(bounds.get("min", []))
	var maximum := _point(bounds.get("max", []))
	var chunk_min_x := chunk.x * CHUNK_SIZE
	var chunk_min_z := chunk.y * CHUNK_SIZE
	var chunk_max_x := chunk_min_x + CHUNK_SIZE
	var chunk_max_z := chunk_min_z + CHUNK_SIZE
	if maximum.x <= chunk_min_x or minimum.x >= chunk_max_x or maximum.z <= chunk_min_z or minimum.z >= chunk_max_z:
		return {}
	return {
		"max": [mini(maximum.x, chunk_max_x), maximum.y, mini(maximum.z, chunk_max_z)],
		"min": [maxi(minimum.x, chunk_min_x), minimum.y, maxi(minimum.z, chunk_min_z)],
		"unit": "world_unit",
	}

static func _merge_bounds(first: Dictionary, second: Dictionary) -> Dictionary:
	if first.is_empty():
		return second.duplicate(true)
	if second.is_empty():
		return first.duplicate(true)
	var first_minimum := _point(first.get("min", []))
	var first_maximum := _point(first.get("max", []))
	var second_minimum := _point(second.get("min", []))
	var second_maximum := _point(second.get("max", []))
	return {
		"max": [maxi(first_maximum.x, second_maximum.x), maxi(first_maximum.y, second_maximum.y), maxi(first_maximum.z, second_maximum.z)],
		"min": [mini(first_minimum.x, second_minimum.x), mini(first_minimum.y, second_minimum.y), mini(first_minimum.z, second_minimum.z)],
		"unit": "world_unit",
	}

static func _structural_point(bounds: Dictionary, first: Vector2i, second: Vector2i, axis: String) -> Vector3:
	var minimum := _point(bounds.get("min", []))
	var maximum := _point(bounds.get("max", []))
	if axis == "x":
		return Vector3(float(maxi(first.x, second.x) * CHUNK_SIZE), minimum.y, (minimum.z + maximum.z) * 0.5)
	return Vector3((minimum.x + maximum.x) * 0.5, minimum.y, float(maxi(first.y, second.y) * CHUNK_SIZE))

static func _ordered_chunks(first: Vector2i, second: Vector2i) -> Array:
	var ordered: Array = []
	if _chunk_less(first, second):
		ordered.append(first)
		ordered.append(second)
	else:
		ordered.append(second)
		ordered.append(first)
	return ordered

static func _chunk_less(first: Vector2i, second: Vector2i) -> bool:
	return first.x < second.x or (first.x == second.x and first.y < second.y)

static func _chunk_point(chunk: Vector2i) -> Array[int]:
	return [chunk.x, chunk.y]

static func _point(value: Variant) -> Vector3i:
	if value is Array and value.size() == 3:
		return Vector3i(int(value[0]), int(value[1]), int(value[2]))
	return Vector3i.ZERO

static func _point_fp(value: Vector3) -> Array[int]:
	return [roundi(value.x * POINT_SCALE), roundi(value.y * POINT_SCALE), roundi(value.z * POINT_SCALE)]
