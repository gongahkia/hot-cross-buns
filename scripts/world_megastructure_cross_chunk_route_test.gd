extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const INTERSECTION := preload("res://scripts/world_megastructure_intersection.gd")

const CELLS := [Vector3i(-2, 0, 1), Vector3i(-1, 0, -3), Vector3i.ZERO, Vector3i(4, 0, -2), Vector3i(7, 0, 5)]
const CHUNK_SIZE := 64

var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260731)
	for cell: Vector3i in CELLS:
		_assert_cross_chunk_baseline(generator.generate(cell))
	quit(1 if failed else 0)

func _assert_cross_chunk_baseline(descriptor: Dictionary) -> void:
	var baseline := _baseline_route(descriptor.get("routes", []))
	var route_id := str(baseline.get("route_id", ""))
	var crossings := _crossings(_route_points(baseline))
	_expect(not route_id.is_empty() and crossings.size() >= 4, "generated baseline route did not cross chunks")
	var manifest := {}
	for crossing: Dictionary in crossings:
		var first: Dictionary = INTERSECTION.compile(descriptor, crossing.first)
		var second: Dictionary = INTERSECTION.compile(descriptor, crossing.second)
		var ports := _shared_route_ports(first, second, route_id)
		_expect(ports.size() == 1, "cross-chunk baseline route lost a shared port")
		if ports.size() != 1:
			continue
		var port: Dictionary = ports[0]
		_expect(bool(port.get("mandatory", false)) and _route_segment_touches(first, route_id, port) and _route_segment_touches(second, route_id, port), "cross-chunk baseline segment does not meet its port")
		manifest[str(port.get("contract_key", ""))] = port
	var reversed := crossings.duplicate()
	reversed.reverse()
	var reverse_manifest := {}
	for crossing: Dictionary in reversed:
		for port: Dictionary in _shared_route_ports(INTERSECTION.compile(descriptor, crossing.first), INTERSECTION.compile(descriptor, crossing.second), route_id):
			reverse_manifest[str(port.get("contract_key", ""))] = port
	_expect(manifest == reverse_manifest, "cross-chunk baseline contracts changed with traversal order")

func _baseline_route(routes: Array) -> Dictionary:
	for route: Dictionary in routes:
		if str(route.get("route_class", "")) == "baseline":
			return route
	return {}

func _route_points(route: Dictionary) -> Array:
	var points: Array = [route.get("start_anchor", [])]
	for waypoint in route.get("waypoints", []):
		points.append(waypoint)
	points.append(route.get("end_anchor", []))
	return points

func _crossings(points: Array) -> Array:
	var result: Array = []
	for index in range(points.size() - 1):
		var start: Array = points[index]
		var finish: Array = points[index + 1]
		var current := Vector2i(floori(float(start[0]) / CHUNK_SIZE), floori(float(start[2]) / CHUNK_SIZE))
		var destination := Vector2i(floori(float(finish[0]) / CHUNK_SIZE), floori(float(finish[2]) / CHUNK_SIZE))
		var direction := Vector2i(signi(int(finish[0]) - int(start[0])), signi(int(finish[2]) - int(start[2])))
		if direction.x != 0 and direction.y != 0:
			failed = true
			push_error("generated baseline route cannot cross a diagonal chunk boundary")
			return []
		while current != destination:
			var neighbor := current + direction
			result.append({"first":current,"second":neighbor})
			current = neighbor
	return result

func _shared_route_ports(first: Dictionary, second: Dictionary, route_id: String) -> Array:
	var first_by_key := {}
	for port: Dictionary in first.get("traversal_ports", []):
		if str(port.get("route_id", "")) == route_id:
			first_by_key[str(port.get("contract_key", ""))] = port
	var shared: Array = []
	for port: Dictionary in second.get("traversal_ports", []):
		var key := str(port.get("contract_key", ""))
		if str(port.get("route_id", "")) == route_id and first_by_key.has(key) and first_by_key[key] == port:
			shared.append(port)
	return shared

func _route_segment_touches(intersection: Dictionary, route_id: String, port: Dictionary) -> bool:
	var point: Array = port.get("point_fp", [])
	for segment: Dictionary in intersection.get("traversal_segments", []):
		if str(segment.get("route_id", "")) == route_id and (segment.get("start_fp", []) == point or segment.get("end_fp", []) == point):
			return true
	return false

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
