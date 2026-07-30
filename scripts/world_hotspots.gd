class_name WorldHotspots
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

var seed: int
var count: int
var extent: float
var min_separation: float
var bucket_size: float
var sigma: float
var trail_dt: float
var trail_steps: int
var tau: float
var elevation_scale: float
var flood_basalt_threshold: float
var _hotspots: Array[Dictionary] = []
var _grid: Dictionary = {}

func _init(next_seed: int, options: Dictionary = {}) -> void:
	seed = next_seed
	count = int(options.get("count", 64))
	extent = float(options.get("extent", 65536.0))
	min_separation = float(options.get("min_separation", 4096.0))
	bucket_size = float(options.get("bucket_size", 8192.0))
	sigma = float(options.get("sigma", 1024.0))
	trail_dt = float(options.get("trail_dt", 0.2))
	trail_steps = int(options.get("trail_steps", 8))
	tau = float(options.get("tau", 3.0))
	elevation_scale = float(options.get("elevation_scale", 0.42))
	flood_basalt_threshold = float(options.get("flood_basalt_threshold", 0.34))
	assert(count >= 0, "hotspot count must be non-negative")
	assert(extent > 0.0 and min_separation >= 0.0, "hotspot extent and separation must be valid")
	assert(bucket_size > 0.0 and sigma > 0.0, "hotspot bucket size and sigma must be positive")
	assert(trail_dt > 0.0 and trail_steps > 0 and tau > 0.0, "hotspot trail settings must be positive")
	_build()

func hotspots() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for hotspot in _hotspots:
		result.append(hotspot.duplicate())
	return result

func sample(world_x: float, world_z: float, plate: Dictionary, geologic_time: float = 0.0, plate_cell_size: float = 640.0) -> Dictionary:
	var bucket_count := maxi(1, floori(extent / bucket_size))
	var current_drift_x := tanh(float(plate.get("vx", 0.0)) * geologic_time) * plate_cell_size * 0.4
	var current_drift_z := tanh(float(plate.get("vz", 0.0)) * geologic_time) * plate_cell_size * 0.4
	var mantle_x := _wrap(world_x - current_drift_x)
	var mantle_z := _wrap(world_z - current_drift_z)
	var max_trail := mini(trail_steps - 1, floori(maxf(0.0, geologic_time) / trail_dt))
	var sum := 0.0
	var best_weight := 0.0
	var best_id := 0
	var best_age := 0.0
	var bucket_radius := maxi(1, ceili(sigma * 3.0 / bucket_size))
	var sigma_squared := sigma * sigma
	var max_distance_squared := sigma_squared * 9.0
	for age_index in range(max_trail + 1):
		var age_time := float(age_index) * trail_dt
		var past_drift_x := tanh(float(plate.get("vx", 0.0)) * age_time) * plate_cell_size * 0.4
		var past_drift_z := tanh(float(plate.get("vz", 0.0)) * age_time) * plate_cell_size * 0.4
		var target_x := _wrap(mantle_x + past_drift_x)
		var target_z := _wrap(mantle_z + past_drift_z)
		var bucket_x := floori(target_x / bucket_size)
		var bucket_z := floori(target_z / bucket_size)
		var age_decay := exp(-float(age_index) / tau)
		for z_offset in range(-bucket_radius, bucket_radius + 1):
			for x_offset in range(-bucket_radius, bucket_radius + 1):
				var key := _bucket_key(posmod(bucket_x + x_offset, bucket_count), posmod(bucket_z + z_offset, bucket_count))
				for hotspot_id in _grid.get(key, []):
					var hotspot: Dictionary = _hotspots[int(hotspot_id) - 1]
					var distance_squared := _distance_squared(target_x, target_z, float(hotspot.x), float(hotspot.z))
					if distance_squared <= max_distance_squared:
						var weight := float(hotspot.intensity) * exp(-distance_squared / sigma_squared) * age_decay
						sum += weight
						if weight > best_weight:
							best_weight = weight
							best_id = int(hotspot.id)
							best_age = age_time * 100.0
	var contribution := clampf(sum * elevation_scale, 0.0, 0.45)
	return {"contribution": contribution, "hotspot_id": best_id, "hotspot_age_my": best_age, "is_flood_basalt": contribution > flood_basalt_threshold and float(plate.get("boundary", 1.0)) < 0.18, "intensity": best_weight}

func _build() -> void:
	var random := RNG.new(seed + 1201)
	var attempts := 0
	var max_attempts := count * 320
	while _hotspots.size() < count and attempts < max_attempts:
		attempts += 1
		var x := random.next_unit() * extent
		var z := random.next_unit() * extent
		var accepted := true
		for existing in _hotspots:
			if _distance_squared(x, z, float(existing.x), float(existing.z)) < min_separation * min_separation:
				accepted = false
				break
		if not accepted:
			continue
		var hotspot := {"id": _hotspots.size() + 1, "x": x, "z": z, "intensity": 0.72 + random.next_unit() * 0.56}
		_hotspots.append(hotspot)
		var key := _bucket_key(floori(x / bucket_size), floori(z / bucket_size))
		if not _grid.has(key):
			_grid[key] = []
		_grid[key].append(hotspot.id)

func _wrap(value: float) -> float:
	return value - floorf(value / extent) * extent

func _distance_squared(ax: float, az: float, bx: float, bz: float) -> float:
	var dx := absf(ax - bx)
	var dz := absf(az - bz)
	if dx > extent * 0.5:
		dx = extent - dx
	if dz > extent * 0.5:
		dz = extent - dz
	return dx * dx + dz * dz

func _bucket_key(x: int, z: int) -> String:
	return "%d:%d" % [x, z]
