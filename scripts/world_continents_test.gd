extends SceneTree

const CONTINENTS = preload("res://scripts/world_continents.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var world = CONTINENTS.new(20260730)
	_assert_sample(world.sample(128.0, -384.0), "local", 1, "oceanic", -0.3276037527849, -0.44457419745958, 5408.06839794113, 0.0)
	_assert_sample(world.sample(-4480.0, -6400.0, "region"), "region", 4, "oceanic", -0.22453233392212, -0.47337052859441, 5536.47484203411, 1.0)
	_assert_sample(world.sample(-7680.0, -7680.0), "local", 1, "continental", 0.22, 0.19695316948573, 0.0, 0.0)
	_expect(world.sample(128.0, -384.0) == CONTINENTS.new(20260730).sample(128.0, -384.0), "continental base synthesis is not repeatable")
	quit(1 if failed else 0)

func _assert_sample(sample: Dictionary, scale: String, factor: int, crust: String, bias: float, elevation: float, ocean_depth: float, shelf_proximity: float) -> void:
	_expect(str(sample.get("scale", "")) == scale and int(sample.get("scale_factor", 0)) == factor, "continental scale synthesis drifted")
	var plate: Dictionary = sample.get("plate", {})
	_expect(str(plate.get("crust", "")) == crust, "continental crust branch drifted")
	_expect(absf(float(sample.get("continental_bias", 0.0)) - bias) <= EPSILON, "continental bias drifted")
	_expect(absf(float(sample.get("elevation", 0.0)) - elevation) <= EPSILON, "continental elevation drifted")
	_expect(absf(float(sample.get("ocean_depth_meters", 0.0)) - ocean_depth) <= EPSILON, "continental ocean-depth coupling drifted")
	_expect(absf(float(sample.get("shelf_proximity", 0.0)) - shelf_proximity) <= EPSILON, "continental shelf blending drifted")
	var expected := float(sample.get("continental_bias", 0.0)) + (float(sample.get("continent", 0.0)) - 0.5) * 0.72 + (float(sample.get("rough", 0.0)) - 0.5) * 0.24 * (1.0 - float(sample.get("stable_damping", 0.0)))
	_expect(absf(float(sample.get("elevation", 0.0)) - expected) <= EPSILON, "continental elevation composition drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
