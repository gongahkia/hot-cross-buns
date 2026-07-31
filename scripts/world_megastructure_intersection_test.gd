extends SceneTree

const CACHE := preload("res://scripts/world_chunk_cache.gd")
const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const INTERSECTION := preload("res://scripts/world_megastructure_intersection.gd")

var failed := false

class IntersectionTask extends RefCounted:
	const TASK_INTERSECTION := preload("res://scripts/world_megastructure_intersection.gd")
	var chunk: Vector2i
	var descriptor: Dictionary
	var result: Dictionary = {}
	var task_id := -1
	func _init(next_descriptor: Dictionary, next_chunk: Vector2i) -> void:
		descriptor = next_descriptor
		chunk = next_chunk
	func compile() -> void:
		result = TASK_INTERSECTION.compile(descriptor, chunk)

func _initialize() -> void:
	var descriptor := GENERATOR.new(20260730).generate(Vector3i.ZERO)
	var route_chunks := _route_chunks(descriptor)
	_expect(route_chunks.size() >= 4, "fixture did not span enough chunks")
	var first_chunk: Vector2i = route_chunks[1]
	var first: Dictionary = INTERSECTION.compile(descriptor, first_chunk)
	_expect(str(first.schema) == "megastructure-intersection/v1" and not (first.macro as Dictionary).is_empty() and not (first.sectors as Array).is_empty(), "macro or sector chunk intersection drifted")
	_assert_shared_ports(descriptor, route_chunks)
	_assert_cache_independence(descriptor, route_chunks)
	_assert_order_independence(descriptor, route_chunks)
	_assert_worker_order_independence(descriptor, route_chunks)
	quit(1 if failed else 0)

func _route_chunks(descriptor: Dictionary) -> Array:
	var route: Dictionary = (descriptor.get("routes", []) as Array)[0]
	var start: Array = route.get("start_anchor", [])
	var finish: Array = route.get("end_anchor", [])
	var direction := Vector2i(signi(int(finish[0]) - int(start[0])), signi(int(finish[2]) - int(start[2])))
	var chunk := Vector2i(floori(float(start[0]) / 64.0), floori(float(start[2]) / 64.0))
	var result: Array = [chunk]
	while chunk != Vector2i(floori(float(finish[0]) / 64.0), floori(float(finish[2]) / 64.0)):
		chunk += direction
		result.append(chunk)
	return result

func _assert_shared_ports(descriptor: Dictionary, chunks: Array) -> void:
	for index in range(chunks.size() - 1):
		var first: Dictionary = INTERSECTION.compile(descriptor, chunks[index])
		var second: Dictionary = INTERSECTION.compile(descriptor, chunks[index + 1])
		var shared_traversal := _shared(first.traversal_ports, second.traversal_ports)
		var shared_structure := _shared(first.structural_ports, second.structural_ports)
		_expect(not shared_traversal.is_empty(), "neighboring chunks lost a traversal port")
		_expect(not shared_structure.is_empty(), "neighboring chunks lost a structural continuation port")
		for port: Dictionary in shared_traversal + shared_structure:
			var owner: Array = port.get("owner_chunk", [])
			var sides: Array = port.get("chunks", [])
			_expect(owner == sides[0] and str(port.contract_key).begins_with("mega-boundary:") and (port.point_fp as Array).size() == 3, "canonical boundary ownership drifted")

func _assert_cache_independence(descriptor: Dictionary, chunks: Array) -> void:
	var cache := CACHE.new(2)
	var target := chunks[1] as Vector2i
	var expected := INTERSECTION.compile(descriptor, target)
	cache.put("target", expected)
	cache.put("other-a", INTERSECTION.compile(descriptor, chunks[2]))
	cache.put("other-b", INTERSECTION.compile(descriptor, chunks[3]))
	_expect(cache.fetch("target").is_empty() and INTERSECTION.compile(descriptor, target) == expected, "intersection changed after cache eviction")

func _assert_order_independence(descriptor: Dictionary, chunks: Array) -> void:
	var forward := _compile_map(descriptor, chunks)
	var reverse := chunks.duplicate()
	reverse.reverse()
	var shuffled: Array = []
	var first := 0
	var last := chunks.size() - 1
	while first <= last:
		shuffled.append(chunks[last])
		last -= 1
		if first <= last:
			shuffled.append(chunks[first])
			first += 1
	_expect(forward == _compile_map(descriptor, reverse) and forward == _compile_map(descriptor, shuffled), "intersection changed with completion order")

func _compile_map(descriptor: Dictionary, chunks: Array) -> Dictionary:
	var result := {}
	for chunk: Vector2i in chunks:
		result["%d:%d" % [chunk.x, chunk.y]] = INTERSECTION.compile(descriptor, chunk)
	return result

func _assert_worker_order_independence(descriptor: Dictionary, chunks: Array) -> void:
	var reverse := chunks.duplicate()
	reverse.reverse()
	_expect(_compile_in_workers(descriptor, chunks) == _compile_in_workers(descriptor, reverse), "intersection changed with worker queue order")

func _compile_in_workers(descriptor: Dictionary, chunks: Array) -> Dictionary:
	var tasks: Array = []
	for chunk: Vector2i in chunks:
		var task := IntersectionTask.new(descriptor, chunk)
		task.task_id = WorkerThreadPool.add_task(task.compile)
		tasks.append(task)
	for task: IntersectionTask in tasks:
		WorkerThreadPool.wait_for_task_completion(task.task_id)
	var result := {}
	for task: IntersectionTask in tasks:
		result["%d:%d" % [task.chunk.x, task.chunk.y]] = task.result
	return result

func _shared(first: Array, second: Array) -> Array:
	var lookup := {}
	for port: Dictionary in first:
		lookup[str(port.contract_key)] = port
	var result: Array = []
	for port: Dictionary in second:
		if lookup.has(str(port.contract_key)) and lookup[str(port.contract_key)] == port:
			result.append(port)
	return result

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
