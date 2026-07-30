class_name WorldPlates
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

var seed: int
var cell_size: float
var cache_capacity: int
var geologic_time: float
var _cache: Dictionary = {}
var _cache_order: Array[String] = []
var _hits := 0
var _misses := 0
var _evictions := 0

func _init(next_seed: int, next_cell_size: float = 640.0, next_cache_capacity: int = 4096, next_geologic_time: float = 0.0) -> void:
	assert(next_cell_size > 0.0, "plate cell size must be positive")
	seed = next_seed
	cell_size = next_cell_size
	cache_capacity = maxi(next_cache_capacity, 0)
	geologic_time = next_geologic_time

func center(cell_x: int, cell_z: int) -> Dictionary:
	var key := _key(cell_x, cell_z)
	if _cache.has(key):
		_hits += 1
		_touch(key)
		return (_cache[key] as Dictionary).duplicate()
	_misses += 1
	var generated := _build_center(cell_x, cell_z)
	if cache_capacity > 0:
		_cache[key] = generated
		_cache_order.append(key)
		if _cache_order.size() > cache_capacity:
			var evicted_key: String = _cache_order.pop_front()
			_cache.erase(evicted_key)
			_evictions += 1
	return generated.duplicate()

func center_at(world_x: float, world_z: float) -> Dictionary:
	return center(floori(world_x / cell_size), floori(world_z / cell_size))

func nearest(world_x: float, world_z: float) -> Dictionary:
	var cell_x := floori(world_x / cell_size)
	var cell_z := floori(world_z / cell_size)
	var first: Dictionary = {}
	var second: Dictionary = {}
	var first_distance := INF
	var second_distance := INF
	for z_offset in range(-1, 2):
		for x_offset in range(-1, 2):
			var plate := center(cell_x + x_offset, cell_z + z_offset)
			var distance := Vector2(world_x - float(plate.x), world_z - float(plate.z)).length()
			if distance < first_distance:
				second = first
				second_distance = first_distance
				first = plate
				first_distance = distance
			elif distance < second_distance:
				second = plate
				second_distance = distance
	return {"first": first, "second": second, "first_distance": first_distance, "second_distance": second_distance}

func plate_at(world_x: float, world_z: float) -> Dictionary:
	var nearest_pair := nearest(world_x, world_z)
	var first: Dictionary = nearest_pair.first
	var second: Dictionary = nearest_pair.second
	var first_distance := float(nearest_pair.first_distance)
	var second_distance := float(nearest_pair.second_distance)
	var gap := maxf(0.0, second_distance - first_distance)
	var boundary := clampf(1.0 - gap / (cell_size * 0.34), 0.0, 1.0)
	var normal := Vector2(float(second.x) - float(first.x), float(second.z) - float(first.z)).normalized()
	var relative_velocity := (float(first.vx) - float(second.vx)) * normal.x + (float(first.vz) - float(second.vz)) * normal.y
	var convergent := clampf(relative_velocity, 0.0, 1.0)
	var divergent := clampf(-relative_velocity, 0.0, 1.0)
	var subducting: Dictionary = {}
	if convergent > 0.0:
		if str(first.crust) != str(second.crust):
			subducting = first if str(first.crust) == "oceanic" else second
		elif str(first.crust) == "oceanic":
			subducting = first if float(first.age) >= float(second.age) else second
	var first_subducts := not subducting.is_empty() and int(subducting.id) == int(first.id)
	var oceanic_subduction := boundary * convergent if not subducting.is_empty() else 0.0
	var ocean_ocean_subduction := oceanic_subduction if str(first.crust) == "oceanic" and str(second.crust) == "oceanic" else 0.0
	var continent_ocean_subduction := oceanic_subduction if str(first.crust) != str(second.crust) else 0.0
	return {"id": first.id, "secondary_id": second.id, "crust": first.crust, "secondary_crust": second.crust, "age": first.age, "secondary_age": second.age, "boundary": boundary, "convergent": convergent, "divergent": divergent, "oceanic_subduction": oceanic_subduction, "ocean_ocean_subduction": ocean_ocean_subduction, "continent_ocean_subduction": continent_ocean_subduction, "subducting": first_subducts, "subduction_bias": oceanic_subduction * (-1.0 if first_subducts else 1.0), "vx": first.vx, "vz": first.vz}

func clear_cache() -> void:
	_cache.clear()
	_cache_order.clear()

func set_geologic_time(next_geologic_time: float) -> void:
	if geologic_time == next_geologic_time:
		return
	geologic_time = next_geologic_time
	clear_cache()

func cache_metrics() -> Dictionary:
	return {"hits": _hits, "misses": _misses, "evictions": _evictions, "size": _cache.size(), "capacity": cache_capacity, "geologic_time": geologic_time}

static func drift(vx: float, vz: float, next_cell_size: float, next_geologic_time: float) -> Vector2:
	return Vector2(tanh(vx * next_geologic_time), tanh(vz * next_geologic_time)) * next_cell_size * 0.4

func _build_center(cell_x: int, cell_z: int) -> Dictionary:
	var jitter_x := RNG.thoth_signed(seed, cell_x, cell_z, 11) * cell_size * 0.38
	var jitter_z := RNG.thoth_signed(seed, cell_x, cell_z, 23) * cell_size * 0.38
	var angle := RNG.unit_at(seed, cell_x, cell_z, 41) * TAU
	var speed := 0.25 + RNG.unit_at(seed, cell_x, cell_z, 43) * 0.75
	var vx := cos(angle) * speed
	var vz := sin(angle) * speed
	var drift_x := tanh(vx * geologic_time) * cell_size * 0.4
	var drift_z := tanh(vz * geologic_time) * cell_size * 0.4
	return {"id": RNG.thoth_hash(seed, cell_x, cell_z, 37), "x": (float(cell_x) + 0.5) * cell_size + jitter_x + drift_x, "z": (float(cell_z) + 0.5) * cell_size + jitter_z + drift_z, "cell_x": cell_x, "cell_z": cell_z, "vx": vx, "vz": vz, "crust": "continental" if RNG.unit_at(seed, cell_x, cell_z, 47) > 0.66 else "oceanic", "age": RNG.unit_at(seed, cell_x, cell_z, 49)}

func _touch(key: String) -> void:
	var index := _cache_order.find(key)
	if index >= 0:
		_cache_order.remove_at(index)
	_cache_order.append(key)

func _key(cell_x: int, cell_z: int) -> String:
	return "%d:%d" % [cell_x, cell_z]
