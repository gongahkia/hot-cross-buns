class_name WorldOcean
extends RefCounted

const DEFAULT_MAX_AGE_MY := 180.0
const DEFAULT_Z_SCALE := 10000.0

static func gdh1_depth_meters(age_my: float) -> float:
	var age := maxf(0.0, age_my)
	if age < 20.0:
		return 2600.0 + 365.0 * sqrt(age)
	return 5651.0 - 2473.0 * exp(-age / 36.0)

static func sample(plate: Dictionary, sea_level: float = 0.0, z_scale: float = DEFAULT_Z_SCALE, max_age_my: float = DEFAULT_MAX_AGE_MY) -> Dictionary:
	assert(z_scale > 0.0 and max_age_my >= 0.0, "ocean depth settings must be valid")
	var normalized_age := clampf(float(plate.get("age", 0.0)), 0.0, 1.0)
	var age_my := normalized_age * max_age_my
	var depth_meters := gdh1_depth_meters(age_my)
	return {"age_my": age_my, "depth_meters": depth_meters, "elevation": sea_level - depth_meters / z_scale}
