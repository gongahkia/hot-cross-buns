extends SceneTree

const HOTSPOTS = preload("res://scripts/world_hotspots.gd")
const EPSILON := 0.000001
const EXTENT := 65536.0
const MIN_SEPARATION := 4096.0

var failed := false

func _initialize() -> void:
	var field = HOTSPOTS.new(20260730, {"count": 4})
	var generated := field.hotspots()
	_expect(generated.size() == 4, "hotspot generation count drifted")
	_assert_hotspot(generated[0], 1, 29254.514082226, 40457.263171916, 0.76517334101963)
	_assert_hotspot(generated[1], 2, 56448.071223795, 14574.043860546, 1.0639091152809)
	_assert_hotspot(generated[2], 3, 23043.361674549, 49119.392173752, 0.85018717585606)
	_assert_hotspot(generated[3], 4, 59118.825833193, 25257.794109662, 1.1709280672162)
	for left_index in range(generated.size()):
		for right_index in range(left_index + 1, generated.size()):
			_expect(_distance_squared(generated[left_index], generated[right_index]) >= MIN_SEPARATION * MIN_SEPARATION, "hotspot separation drifted")
	generated[0]["x"] = 0.0
	_expect(absf(float(field.hotspots()[0].get("x", 0.0)) - 29254.514082226) <= EPSILON, "hotspot result mutated internal field")
	_expect(field.hotspots() == HOTSPOTS.new(20260730, {"count": 4}).hotspots(), "hotspot generation is not repeatable")
	var plate := {"vx": -0.10808972967778, "vz": 0.47490956734389, "boundary": 0.1}
	_assert_sample(field.sample(29254.5140822262, 40457.2631719156, plate, 0.0), 0.32137280322824, 1, 0.0, 0.76517334101963, false)
	_assert_sample(field.sample(29254.5140822262, 40457.2631719156, plate, 1.0), 0.45, 1, 0.0, 0.75533312470914, true)
	_expect(field.sample(29254.5140822262 - EXTENT, 40457.2631719156, plate, 0.0) == field.sample(29254.5140822262, 40457.2631719156, plate, 0.0), "hotspot toroidal wrap drifted")
	quit(1 if failed else 0)

func _assert_hotspot(hotspot: Dictionary, id: int, x: float, z: float, intensity: float) -> void:
	_expect(int(hotspot.get("id", 0)) == id, "hotspot id drifted")
	_expect(absf(float(hotspot.get("x", 0.0)) - x) <= EPSILON, "hotspot x drifted")
	_expect(absf(float(hotspot.get("z", 0.0)) - z) <= EPSILON, "hotspot z drifted")
	_expect(absf(float(hotspot.get("intensity", 0.0)) - intensity) <= EPSILON, "hotspot intensity drifted")

func _assert_sample(actual: Dictionary, contribution: float, hotspot_id: int, age: float, intensity: float, flood_basalt: bool) -> void:
	_expect(absf(float(actual.get("contribution", 0.0)) - contribution) <= EPSILON, "hotspot contribution drifted")
	_expect(int(actual.get("hotspot_id", 0)) == hotspot_id, "hotspot selection drifted")
	_expect(absf(float(actual.get("hotspot_age_my", 0.0)) - age) <= EPSILON, "hotspot trail age drifted")
	_expect(absf(float(actual.get("intensity", 0.0)) - intensity) <= EPSILON, "hotspot trail intensity drifted")
	_expect(bool(actual.get("is_flood_basalt", false)) == flood_basalt, "hotspot flood-basalt classification drifted")

func _distance_squared(left: Dictionary, right: Dictionary) -> float:
	var dx := absf(float(left.get("x", 0.0)) - float(right.get("x", 0.0)))
	var dz := absf(float(left.get("z", 0.0)) - float(right.get("z", 0.0)))
	return pow(minf(dx, EXTENT - dx), 2.0) + pow(minf(dz, EXTENT - dz), 2.0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
