class_name WorldContinents
extends RefCounted

const NOISE = preload("res://scripts/world_noise.gd")
const OCEAN = preload("res://scripts/world_ocean.gd")
const PLATES = preload("res://scripts/world_plates.gd")
const SCALE = preload("res://scripts/world_scale.gd")

var seed: int
var sea_level: float
var max_ocean_age_my: float
var z_scale: float
var plates

func _init(next_seed: int, options: Dictionary = {}) -> void:
	seed = next_seed
	sea_level = float(options.get("sea_level", 0.0))
	max_ocean_age_my = float(options.get("max_ocean_age_my", 180.0))
	z_scale = float(options.get("z_scale", 10000.0))
	plates = PLATES.new(seed, float(options.get("plate_cell_size", 640.0)), int(options.get("plate_cache_capacity", 4096)), float(options.get("geologic_time", 0.0)))

func sample(world_x: float, world_z: float, scope: Variant = "local") -> Dictionary:
	var scale: Dictionary = SCALE.info(scope)
	var factor := float(scale.get("factor", 1))
	var warped := NOISE.warp(seed, world_x, world_z, 48.0 * factor, 0.0015 / factor)
	var plate: Dictionary = plates.plate_at(warped.x, warped.y)
	var continent := NOISE.fbm(seed + 101, warped.x, warped.y, 5, 0.0009, 2.0, 0.5, 1)
	var rough := NOISE.fbm(seed + 202, warped.x, warped.y, 5, 0.008 / sqrt(factor), 2.0, 0.5, 2)
	var ridge := NOISE.ridge(seed + 303, warped.x, warped.y, 4, 0.0035 / sqrt(factor), 2.0, 0.5, 3)
	var shield := _shield(plate)
	var craton := shield * _smoothstep(0.74, 0.96, float(plate.get("age", 0.0))) * (1.0 - _smoothstep(0.08, 0.26, float(plate.get("boundary", 0.0))))
	var stable_damping := clampf((shield + craton) * 0.35, 0.0, 0.62)
	var continental_bias := 0.0
	var ocean_depth_meters := 0.0
	var ocean_age_my := 0.0
	var shelf_proximity := 0.0
	var shelf_distance := 999.0
	if str(plate.get("crust", "")) == "continental":
		continental_bias = 0.22 + shield * 0.04 + craton * 0.04
	else:
		var ocean: Dictionary = OCEAN.sample(plate, sea_level, z_scale, max_ocean_age_my)
		ocean_depth_meters = float(ocean.depth_meters)
		ocean_age_my = float(ocean.age_my)
		var margin_blend := _smoothstep(0.05, 0.45, float(plate.get("boundary", 0.0))) * 0.35 if str(plate.get("secondary_crust", "")) == "continental" else 0.0
		var ocean_weight := _smoothstep(0.0, 1.0, 0.46 * (1.0 - margin_blend))
		shelf_proximity = _smoothstep(0.04, 0.42, float(plate.get("boundary", 0.0))) if str(plate.get("secondary_crust", "")) == "continental" else 0.0
		shelf_distance = (1.0 - shelf_proximity) * 50.0 if shelf_proximity > 0.0 else 999.0
		continental_bias = -0.16 * (1.0 - ocean_weight) + float(ocean.elevation) * ocean_weight + shelf_proximity * 0.02
	var rough_contribution := (rough - 0.5) * 0.24 * (1.0 - stable_damping)
	var elevation := continental_bias + (continent - 0.5) * 0.72 + rough_contribution
	return {"x": world_x, "z": world_z, "scale": scale.id, "scale_factor": scale.factor, "warped_x": warped.x, "warped_z": warped.y, "plate": plate, "continent": continent, "rough": rough, "ridge": ridge, "shield": shield, "craton": craton, "stable_damping": stable_damping, "continental_bias": continental_bias, "ocean_depth_meters": ocean_depth_meters, "ocean_age_my": ocean_age_my, "shelf_proximity": shelf_proximity, "shelf_distance": shelf_distance, "elevation": elevation}

func _shield(plate: Dictionary) -> float:
	if str(plate.get("crust", "")) != "continental":
		return 0.0
	return _smoothstep(0.52, 0.86, float(plate.get("age", 0.0))) * (1.0 - _smoothstep(0.18, 0.46, float(plate.get("boundary", 0.0))))

func _smoothstep(minimum: float, maximum: float, value: float) -> float:
	var t := clampf((value - minimum) / (maximum - minimum), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
