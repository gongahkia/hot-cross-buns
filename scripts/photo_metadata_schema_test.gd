extends SceneTree

const PNG := preload("res://scripts/png_metadata.gd")
const SCHEMA := preload("res://scripts/photo_metadata_schema.gd")

var failed := false

func _initialize() -> void:
	var source := {"run":{"seed":20260730,"outcome":"active","survival":{"health":88.0}},"world":{"biome":"temperate_forest","region":{"id":"-1:2"}},"position":[12.5,3.0,-8.25]}
	var metadata := SCHEMA.build(source, Vector3(12.5, 3.0, -8.25), 75.0, Vector2i(2, 3), "2026-07-31T10:20:30Z")
	_expect(bool(SCHEMA.validate(metadata).valid), "valid photo metadata rejected")
	source.run.seed = 0
	_expect(int(metadata.run.seed) == 20260730, "photo metadata builder leaked source mutation")
	var encoded := SCHEMA.encode(metadata)
	_expect(not encoded.is_empty(), "valid photo metadata did not encode")
	var png := PNG.signature()
	png.append_array(PNG._chunk(PNG.ihdr(), PackedByteArray([0,0,0,2,0,0,0,3,8,6,0,0,0])))
	png.append_array(PNG._chunk(PackedByteArray([73,69,78,68]), PackedByteArray()))
	var embedded := PNG.embed(png, SCHEMA.PNG_KEYWORD, encoded)
	var extracted := PNG.extract(embedded, SCHEMA.PNG_KEYWORD)
	var sidecar: Variant = JSON.parse_string(encoded)
	var embedded_sidecar: Variant = JSON.parse_string(extracted)
	_expect(sidecar is Dictionary and embedded_sidecar is Dictionary and sidecar == embedded_sidecar and bool(SCHEMA.validate(embedded_sidecar).valid), "embedded and sidecar metadata diverged")
	_assert_rejections(metadata)
	quit(1 if failed else 0)

func _assert_rejections(valid: Dictionary) -> void:
	var unknown := valid.duplicate(true)
	unknown["unexpected"] = true
	_expect(str(SCHEMA.validate(unknown).status) == "invalid_envelope", "unknown photo metadata key accepted")
	var invalid_camera := valid.duplicate(true)
	invalid_camera.camera.fov = 180.0
	_expect(str(SCHEMA.validate(invalid_camera).status) == "invalid_camera", "invalid photo FOV accepted")
	var invalid_capture := valid.duplicate(true)
	invalid_capture.capture.width = 0
	_expect(str(SCHEMA.validate(invalid_capture).status) == "invalid_capture", "invalid photo dimensions accepted")
	var invalid_timestamp := valid.duplicate(true)
	invalid_timestamp.captured_at = "2026-07-31 10:20:30"
	_expect(str(SCHEMA.validate(invalid_timestamp).status) == "invalid_timestamp", "invalid photo timestamp accepted")
	var wrong_schema := valid.duplicate(true)
	wrong_schema.schema = "a-slow-walk.photo.v2"
	_expect(str(SCHEMA.validate(wrong_schema).status) == "schema_mismatch", "unknown photo schema accepted")
	var metadata_only := valid.duplicate(true)
	metadata_only["extensions"] = {"org.example.fixture":{"caption":"alternate"}}
	_expect(bool(SCHEMA.validate(metadata_only).valid), "namespaced photo extension rejected")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
