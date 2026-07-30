extends SceneTree

const PLATES = preload("res://scripts/world_plates.gd")
const EPSILON := 0.000001
const VECTOR_EPSILON := 0.0001

var failed := false

func _initialize() -> void:
	var zero_time = PLATES.new(20260730, 640.0, 2)
	var drifted = PLATES.new(20260730, 640.0, 2, 3.5)
	var static_center := zero_time.center(0, -1)
	var drifted_center := drifted.center(0, -1)
	_expect(absf(float(static_center.get("x", 0.0)) - 418.16730633378) <= EPSILON, "zero-time plate center drifted")
	_expect(absf(float(static_center.get("z", 0.0)) + 93.168891066313) <= EPSILON, "zero-time plate center drifted")
	_expect(absf(float(drifted_center.get("x", 0.0)) - 325.68924566751) <= EPSILON, "geologic-time plate x drifted")
	_expect(absf(float(drifted_center.get("z", 0.0)) - 145.04184636499) <= EPSILON, "geologic-time plate z drifted")
	var displacement := Vector2(float(drifted_center.get("x", 0.0)) - float(static_center.get("x", 0.0)), float(drifted_center.get("z", 0.0)) - float(static_center.get("z", 0.0)))
	_expect(displacement.distance_to(PLATES.drift(-0.10808972967778, 0.47490956734389, 640.0, 3.5)) <= VECTOR_EPSILON, "plate drift helper diverged from center displacement")
	_expect(PLATES.drift(-0.10808972967778, 0.47490956734389, 640.0, 0.0) == Vector2.ZERO, "zero geologic time moved a plate")
	_expect(absf(displacement.x) < 640.0 * 0.4 and absf(displacement.y) < 640.0 * 0.4, "plate drift exceeded its bounded cell fraction")
	zero_time.center(0, -1)
	zero_time.set_geologic_time(3.5)
	_expect(zero_time.cache_metrics() == {"hits": 1, "misses": 1, "evictions": 0, "size": 0, "capacity": 2, "geologic_time": 3.5}, "geologic-time change did not invalidate plate cache")
	_expect(zero_time.center(0, -1) == drifted_center, "cache-invalidated plate center did not match direct geologic-time construction")
	_expect(zero_time.cache_metrics() == {"hits": 1, "misses": 2, "evictions": 0, "size": 1, "capacity": 2, "geologic_time": 3.5}, "geologic-time cache rebuild drifted")
	zero_time.set_geologic_time(3.5)
	_expect(int(zero_time.cache_metrics().get("size", -1)) == 1, "unchanged geologic time cleared plate cache")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
