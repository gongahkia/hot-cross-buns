class_name WorldPlates
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

var seed: int
var cell_size: float
var cache_capacity: int
var _cache: Dictionary = {}
var _cache_order: Array[String] = []
var _hits := 0
var _misses := 0
var _evictions := 0

func _init(next_seed: int, next_cell_size: float = 640.0, next_cache_capacity: int = 4096) -> void:
	assert(next_cell_size > 0.0, "plate cell size must be positive")
	seed = next_seed
	cell_size = next_cell_size
	cache_capacity = maxi(next_cache_capacity, 0)

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

func clear_cache() -> void:
	_cache.clear()
	_cache_order.clear()

func cache_metrics() -> Dictionary:
	return {"hits": _hits, "misses": _misses, "evictions": _evictions, "size": _cache.size(), "capacity": cache_capacity}

func _build_center(cell_x: int, cell_z: int) -> Dictionary:
	var jitter_x := RNG.thoth_signed(seed, cell_x, cell_z, 11) * cell_size * 0.38
	var jitter_z := RNG.thoth_signed(seed, cell_x, cell_z, 23) * cell_size * 0.38
	return {"id": RNG.thoth_hash(seed, cell_x, cell_z, 37), "x": (float(cell_x) + 0.5) * cell_size + jitter_x, "z": (float(cell_z) + 0.5) * cell_size + jitter_z, "cell_x": cell_x, "cell_z": cell_z}

func _touch(key: String) -> void:
	var index := _cache_order.find(key)
	if index >= 0:
		_cache_order.remove_at(index)
	_cache_order.append(key)

func _key(cell_x: int, cell_z: int) -> String:
	return "%d:%d" % [cell_x, cell_z]
