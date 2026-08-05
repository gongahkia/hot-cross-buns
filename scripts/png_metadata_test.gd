extends SceneTree
const PNG = preload("res://scripts/png_metadata.gd")
var failed := false
func _initialize() -> void:
	var source := PNG.signature()
	source.append_array(PNG._chunk(PNG.ihdr(), PackedByteArray([0,0,0,2,0,0,0,2,8,6,0,0,0])))
	source.append_array(PNG._chunk(PackedByteArray([73,69,78,68]), PackedByteArray()))
	var embedded := PNG.embed(source, "a-slow-walk", "{\"region\":\"雨\"}")
	_expect(not embedded.is_empty() and PNG.extract(embedded, "a-slow-walk") == "{\"region\":\"雨\"}", "PNG iTXt roundtrip drifted")
	_expect(PNG._crc32("123456789".to_ascii_buffer()) == 0xcbf43926, "PNG CRC32 drifted")
	_expect(PNG.embed(PackedByteArray([0]), "a-slow-walk", "metadata").is_empty() and PNG.extract(source, "missing").is_empty(), "invalid PNG metadata handling drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
