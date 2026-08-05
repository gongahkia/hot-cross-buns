extends SceneTree

const OCEAN = preload("res://scripts/world_ocean.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	_expect(absf(OCEAN.gdh1_depth_meters(-1.0) - 2600.0) <= EPSILON, "negative ocean age did not clamp")
	_expect(absf(OCEAN.gdh1_depth_meters(0.0) - 2600.0) <= EPSILON, "young ocean depth drifted")
	_expect(absf(OCEAN.gdh1_depth_meters(10.0) - 3754.23134596146) <= EPSILON, "young ocean cooling depth drifted")
	_expect(absf(OCEAN.gdh1_depth_meters(20.0) - 4232.10779051633) <= EPSILON, "ocean age breakpoint drifted")
	_expect(absf(OCEAN.gdh1_depth_meters(180.0) - 5634.33705707126) <= EPSILON, "old ocean cooling depth drifted")
	var sample := OCEAN.sample({"age": 0.46408146736212}, 0.25)
	_expect(absf(float(sample.get("age_my", 0.0)) - 83.5346641251816) <= EPSILON, "ocean sample age drifted")
	_expect(absf(float(sample.get("depth_meters", 0.0)) - 5408.06839794113) <= EPSILON, "ocean sample depth drifted")
	_expect(absf(float(sample.get("elevation", 0.0)) + 0.29080683979411) <= EPSILON, "ocean sample elevation drifted")
	var clamped := OCEAN.sample({"age": 2.0}, 1.0, 1000.0, 100.0)
	_expect(absf(float(clamped.get("age_my", 0.0)) - 100.0) <= EPSILON, "ocean normalized age did not clamp")
	_expect(absf(float(clamped.get("elevation", 0.0)) - (1.0 - float(clamped.get("depth_meters", 0.0)) / 1000.0)) <= EPSILON, "ocean elevation scaling drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
