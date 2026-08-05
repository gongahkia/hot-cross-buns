extends SceneTree

const GENERATOR = preload("res://scripts/world_generator.gd")
const SCALE = preload("res://scripts/world_scale.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	_expect(SCALE.info("local") == {"id": "local", "factor": 1, "label": "local"}, "local scale definition drifted")
	_expect(SCALE.info(4) == {"id": "region", "factor": 4, "label": "region"}, "region scale definition drifted")
	_expect(SCALE.info("continent") == {"id": "continent", "factor": 16, "label": "continent"}, "continent scale definition drifted")
	_expect(str(SCALE.info(16.0).get("id", "")) == "continent", "numeric continent scale definition drifted")
	_expect(str(SCALE.info("invalid").get("id", "")) == "local", "invalid scale did not fall back to local")
	_expect(is_equal_approx(SCALE.coordinate(-65.5, "local"), -65.5), "local scale changed coordinates")
	_expect(is_equal_approx(SCALE.coordinate(-65.5, "region"), -68.0), "region negative coordinate quantization drifted")
	_expect(is_equal_approx(SCALE.coordinate(-65.5, "continent"), -80.0), "continent negative coordinate quantization drifted")
	var generator = GENERATOR.new(20260730)
	var local_sample: Dictionary = generator.sample(128.9, -384.1)
	_expect(local_sample == generator.sample(128.9, -384.1, "local"), "explicit local scale changed output")
	_assert_sample(generator.sample(128.9, -384.1, "region"), "region", 4, 128.0, -388.0, -1.25116007198738, 0.27705743118208, 0.3632641520088)
	_assert_sample(generator.sample(128.9, -384.1, "continent"), "continent", 16, 128.0, -400.0, -0.47954409015762, 0.26506105796922, 0.36400484025675)
	var descriptor: Dictionary = generator.chunk_descriptor(2, -6, "region")
	_expect(str(descriptor.get("scale", "")) == "region" and int(descriptor.get("scale_factor", 0)) == 4, "scaled chunk metadata drifted")
	_expect(str(descriptor.get("id", "")) == "2:-6", "scaled chunk id drifted")
	_expect((descriptor.get("center", Vector3.ZERO) as Vector3).is_equal_approx(Vector3(640.0, 0.0, -1408.0)), "scaled chunk center drifted")
	_expect(str(descriptor.get("region", {}).get("id", "")) == "1:-3", "scaled chunk region drifted")
	_expect(str(descriptor.get("biome", "")) == "wetland" and bool(descriptor.get("water", false)), "scaled chunk descriptor drifted")
	quit(1 if failed else 0)

func _assert_sample(sample: Dictionary, scale: String, factor: int, sample_x: float, sample_z: float, elevation: float, temperature: float, rainfall: float) -> void:
	_expect(str(sample.get("scale", "")) == scale, "scaled sample id drifted")
	_expect(int(sample.get("scale_factor", 0)) == factor, "scaled sample factor drifted")
	_expect(absf(float(sample.get("sample_x", 0.0)) - sample_x) <= EPSILON, "scaled sample x drifted")
	_expect(absf(float(sample.get("sample_z", 0.0)) - sample_z) <= EPSILON, "scaled sample z drifted")
	_expect(absf(float(sample.get("elevation", 0.0)) - elevation) <= EPSILON, "scaled elevation drifted")
	_expect(absf(float(sample.get("temperature", 0.0)) - temperature) <= EPSILON, "scaled temperature drifted")
	_expect(absf(float(sample.get("rainfall", 0.0)) - rainfall) <= EPSILON, "scaled rainfall drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
