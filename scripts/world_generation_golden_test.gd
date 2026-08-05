extends SceneTree

const GENERATOR = preload("res://scripts/world_generator.gd")
const FIXTURE_PATH := "res://levels/world-generation-fixtures.v1.json"
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var file := FileAccess.open(FIXTURE_PATH, FileAccess.READ)
	_expect(file != null, "world-generation fixtures missing")
	if file == null:
		quit(1)
		return
	var document: Variant = JSON.parse_string(file.get_as_text())
	_expect(document is Dictionary, "world-generation fixtures invalid")
	if not document is Dictionary:
		quit(1)
		return
	var fixture_document: Dictionary = document
	_expect(str(fixture_document.get("schema", "")) == "world-generation-fixtures/v1", "world-generation fixture schema changed")
	for fixture_value in fixture_document.get("cases", []):
		_expect(fixture_value is Dictionary, "world-generation fixture malformed")
		if not fixture_value is Dictionary:
			continue
		var fixture: Dictionary = fixture_value
		var point: Dictionary = fixture.get("point", {})
		var chunk: Dictionary = fixture.get("chunk", {})
		var generator = GENERATOR.new(int(fixture.get("seed", 0)))
		var sample: Dictionary = generator.sample(float(point.get("x", 0.0)), float(point.get("z", 0.0)))
		_assert_sample(sample, fixture.get("sample", {}))
		_assert_sample(GENERATOR.new(int(fixture.get("seed", 0))).sample(float(point.get("x", 0.0)), float(point.get("z", 0.0))), fixture.get("sample", {}))
		_assert_chunk(generator.chunk_descriptor(int(chunk.get("x", 0)), int(chunk.get("z", 0))), chunk)
	quit(1 if failed else 0)

func _assert_sample(actual: Dictionary, expected: Dictionary) -> void:
	_expect(absf(float(actual.get("elevation", 0.0)) - float(expected.get("elevation", 0.0))) <= EPSILON, "world elevation drifted")
	_expect(absf(float(actual.get("temperature", 0.0)) - float(expected.get("temperature", 0.0))) <= EPSILON, "world temperature drifted")
	_expect(absf(float(actual.get("rainfall", 0.0)) - float(expected.get("rainfall", 0.0))) <= EPSILON, "world rainfall drifted")
	_expect(str(actual.get("biome", "")) == str(expected.get("biome", "")), "world biome drifted")
	_expect(bool(actual.get("water", false)) == bool(expected.get("water", false)), "world water classification drifted")
	_assert_region(actual.get("region", {}), expected.get("region", {}))

func _assert_chunk(actual: Dictionary, expected: Dictionary) -> void:
	_expect(str(actual.get("id", "")) == str(expected.get("id", "")), "world chunk id drifted")
	_expect(str(actual.get("biome", "")) == str(expected.get("biome", "")), "world chunk biome drifted")
	_expect(bool(actual.get("water", false)) == bool(expected.get("water", false)), "world chunk water classification drifted")
	_assert_region(actual.get("region", {}), expected.get("region", {}))
	var center: Vector3 = actual.get("center", Vector3.ZERO)
	var expected_center: Array = expected.get("center", [])
	_expect(expected_center.size() == 2, "world-generation chunk center fixture malformed")
	if expected_center.size() == 2:
		_expect(absf(center.x - float(expected_center[0])) <= EPSILON, "world chunk center x drifted")
		_expect(absf(center.z - float(expected_center[1])) <= EPSILON, "world chunk center z drifted")

func _assert_region(actual: Dictionary, expected: Dictionary) -> void:
	_expect(str(actual.get("id", "")) == str(expected.get("id", "")), "world region id drifted")
	_expect(str(actual.get("family", "")) == str(expected.get("family", "")), "world region family drifted")
	_expect(str(actual.get("landmark", "")) == str(expected.get("landmark", "")), "world region landmark drifted")
	_expect(str(actual.get("name", "")) == str(expected.get("name", "")), "world region name drifted")
	_expect(int(actual.get("x", 0)) == int(expected.get("x", 0)), "world region x drifted")
	_expect(int(actual.get("z", 0)) == int(expected.get("z", 0)), "world region z drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
