class_name WorldMegastructurePrototype
extends RefCounted

const CHUNK_SIZE := 64.0

static func compile(descriptor: Dictionary, terrain_height: Callable) -> Node3D:
	var root := Node3D.new()
	root.name = "MegastructurePrototype"
	root.set_meta("descriptor_hash", str(descriptor.get("canonical_hash", "")))
	var entry: Dictionary = descriptor.get("entry", {})
	var reveal: Dictionary = (descriptor.get("reveals", []) as Array)[0]
	var approach := _ground_point(entry.get("approach_anchor", []))
	var post_threshold := _ground_point(entry.get("post_threshold_anchor", []))
	var first_goal := _ground_point(entry.get("first_goal_anchor", []))
	var reveal_anchor := _ground_point(reveal.get("recommended_view_anchor", []))
	var axis := _point(reveal.get("recommended_view_direction", []))
	var transverse := Vector3(-axis.z, 0.0, axis.x)
	var threshold := _ground_point(entry.get("threshold_volume", {}).get("min", [])).lerp(_ground_point(entry.get("threshold_volume", {}).get("max", [])), 0.5)
	var route_y := _route_floor_y(descriptor, terrain_height)
	var wall_start := threshold - axis * 64.0
	var opening_length: float = wall_start.distance_to(first_goal) + 96.0
	var opening_center: Vector3 = (wall_start + first_goal) * 0.5
	_add_box(root, "SpineWallLeft", opening_center + transverse * 30.0 + Vector3(0.0, route_y + 30.0, 0.0), _axis_size(axis, opening_length, 4.0, 60.0), Color("#313936"), true)
	_add_box(root, "SpineWallRight", opening_center - transverse * 30.0 + Vector3(0.0, route_y + 30.0, 0.0), _axis_size(axis, opening_length, 4.0, 60.0), Color("#39413c"), true)
	_add_box(root, "ThresholdLintel", Vector3(threshold.x, route_y + 20.0, threshold.z), _axis_size(axis, 10.0, 68.0, 6.0), Color("#596254"), true)
	_add_box(root, "CompressionWallLeft", post_threshold - axis * 44.0 + transverse * 12.0 + Vector3(0.0, route_y + 14.0, 0.0), _axis_size(axis, 128.0, 2.0, 28.0), Color("#4b5147"), true)
	_add_box(root, "CompressionWallRight", post_threshold - axis * 44.0 - transverse * 12.0 + Vector3(0.0, route_y + 14.0, 0.0), _axis_size(axis, 128.0, 2.0, 28.0), Color("#4b5147"), true)
	_add_box(root, "OpeningRoute", (approach + first_goal) * 0.5 + Vector3(0.0, route_y, 0.0), _axis_size(axis, approach.distance_to(first_goal) + 16.0, 18.0, 0.7), Color("#616853"), true)
	_add_box(root, "TransitDeck", reveal_anchor + axis * 720.0 + Vector3(0.0, route_y + 58.0, 0.0), _axis_size(axis, 2368.0, 36.0, 5.0), Color("#222c2b"), false)
	for distance: float in [192.0, 544.0, 928.0, 1344.0]:
		var support: Vector3 = reveal_anchor + axis * distance
		_add_box(root, "TransitSupport", support + transverse * 16.0 + Vector3(0.0, route_y + 28.0, 0.0), Vector3(5.0, 56.0, 5.0), Color("#303934"), false)
		_add_box(root, "TransitSupport", support - transverse * 16.0 + Vector3(0.0, route_y + 28.0, 0.0), Vector3(5.0, 56.0, 5.0), Color("#303934"), false)
	var signature: Vector3 = reveal_anchor + transverse * 74.0 + axis * 82.0
	_add_box(root, "SignalSpire", signature + Vector3(0.0, route_y + 42.0, 0.0), Vector3(16.0, 84.0, 16.0), Color("#586a59"), true)
	_add_grapple_anchor(root, signature + Vector3(0.0, route_y + 88.0, 0.0))
	var debug := _debug_overlay(descriptor)
	debug.name = "MegastructureDebug"
	debug.visible = false
	root.add_child(debug)
	return root

static func entry_spawn(descriptor: Dictionary, terrain_height: Callable) -> Vector3:
	var approach := _ground_point((descriptor.get("entry", {}) as Dictionary).get("approach_anchor", []))
	return Vector3(approach.x, _route_floor_y(descriptor, terrain_height) + 1.55, approach.z)

static func set_origin(root: Node3D, origin_chunk: Vector2i) -> void:
	root.position = Vector3(-float(origin_chunk.x) * CHUNK_SIZE, 0.0, -float(origin_chunk.y) * CHUNK_SIZE)

static func set_debug_visible(root: Node3D, visible: bool) -> void:
	var debug := root.get_node_or_null("MegastructureDebug") as Node3D
	if debug:
		debug.visible = visible

static func _add_box(root: Node3D, node_name: String, position: Vector3, size: Vector3, color: Color, collides: bool) -> void:
	var host: Node3D = StaticBody3D.new() if collides else Node3D.new()
	host.name = node_name
	host.position = position
	var visual := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	visual.mesh = mesh
	visual.material_override = _material(color)
	host.add_child(visual)
	if collides:
		var collision := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		collision.shape = shape
		host.add_child(collision)
	root.add_child(host)

static func _add_grapple_anchor(root: Node3D, position: Vector3) -> void:
	var anchor := Node3D.new()
	anchor.name = "MegastructureGrappleAnchor"
	anchor.position = position
	anchor.add_to_group("grapple_anchor")
	var visual := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.75
	ring.outer_radius = 1.0
	visual.mesh = ring
	visual.material_override = _material(Color("#cde596"), true)
	anchor.add_child(visual)
	root.add_child(anchor)

static func _debug_overlay(descriptor: Dictionary) -> Node3D:
	var root := Node3D.new()
	_add_wire_box(root, "StructureBounds", descriptor.get("world_bounds", {}), Color("#6bcfa9"))
	for sector: Dictionary in descriptor.get("sectors", []):
		_add_wire_box(root, "SectorBounds", sector.get("bounds", {}), Color("#f0d78a"))
	var entry: Dictionary = descriptor.get("entry", {})
	_add_wire_box(root, "EntryThreshold", entry.get("threshold_volume", {}), Color("#f39a72"))
	for reveal: Dictionary in descriptor.get("reveals", []):
		_add_wire_box(root, "RevealFocus", reveal.get("focus_bounds", {}), Color("#9ccbf2"))
	for route: Dictionary in descriptor.get("routes", []):
		_add_route_line(root, route)
	return root

static func _add_wire_box(root: Node3D, node_name: String, bounds: Dictionary, color: Color) -> void:
	var minimum := _point(bounds.get("min", []))
	var maximum := _point(bounds.get("max", []))
	var corners := [
		Vector3(minimum.x, minimum.y, minimum.z), Vector3(maximum.x, minimum.y, minimum.z), Vector3(maximum.x, minimum.y, maximum.z), Vector3(minimum.x, minimum.y, maximum.z),
		Vector3(minimum.x, maximum.y, minimum.z), Vector3(maximum.x, maximum.y, minimum.z), Vector3(maximum.x, maximum.y, maximum.z), Vector3(minimum.x, maximum.y, maximum.z),
	]
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, _material(color, true))
	for pair in [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]:
		mesh.surface_add_vertex(corners[pair[0]])
		mesh.surface_add_vertex(corners[pair[1]])
	mesh.surface_end()
	var visual := MeshInstance3D.new()
	visual.name = node_name
	visual.mesh = mesh
	root.add_child(visual)

static func _add_route_line(root: Node3D, route: Dictionary) -> void:
	var points := [_point(route.get("start_anchor", []))]
	for waypoint in route.get("waypoints", []):
		points.append(_point(waypoint))
	points.append(_point(route.get("end_anchor", [])))
	var color := Color("#d8f0a4") if bool(route.get("mandatory", false)) else Color("#86c7e8")
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINE_STRIP, _material(color, true))
	for point: Vector3 in points:
		mesh.surface_add_vertex(point + Vector3(0.0, 1.0, 0.0))
	mesh.surface_end()
	var visual := MeshInstance3D.new()
	visual.name = "Route_" + str(route.get("route_class", "unknown"))
	visual.mesh = mesh
	root.add_child(visual)

static func _axis_size(axis: Vector3, length: float, width: float, height: float) -> Vector3:
	return Vector3(length, height, width) if absf(axis.x) > 0.5 else Vector3(width, height, length)

static func _route_floor_y(descriptor: Dictionary, terrain_height: Callable) -> float:
	var entry: Dictionary = descriptor.get("entry", {})
	var start := _ground_point(entry.get("approach_anchor", []))
	var finish := _ground_point(entry.get("first_goal_anchor", []))
	var maximum := 0.0
	for index in range(9):
		maximum = maxf(maximum, float(terrain_height.call(start.lerp(finish, float(index) / 8.0))))
	return maxf(48.0, maximum + 2.0)

static func _material(color: Color, unshaded := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.9
	if unshaded:
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

static func _point(value: Variant) -> Vector3:
	if value is Array and value.size() == 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return Vector3.ZERO

static func _ground_point(value: Variant) -> Vector3:
	var point := _point(value)
	return Vector3(point.x, 0.0, point.z)
