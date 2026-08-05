class_name PhotoMetadataSchema
extends RefCounted

const SCHEMA := "a-slow-walk.photo.v1"
const PNG_KEYWORD := "a-slow-walk"
const MAX_BYTES := 64 * 1024
const MAX_NESTING_DEPTH := 32
const REQUIRED_KEYS := ["schema","run","world","position","camera","capture","captured_at"]
const ALLOWED_KEYS := ["schema","run","world","position","camera","capture","captured_at","extensions"]
const CAMERA_KEYS := ["position","fov"]
const CAPTURE_KEYS := ["width","height"]

static func build(source: Dictionary, camera_position: Vector3, fov: float, capture_size: Vector2i, captured_at: String) -> Dictionary:
	var metadata := source.duplicate(true)
	metadata["schema"] = SCHEMA
	metadata["camera"] = {"position":[camera_position.x,camera_position.y,camera_position.z],"fov":fov}
	metadata["capture"] = {"width":capture_size.x,"height":capture_size.y}
	metadata["captured_at"] = captured_at
	return metadata

static func validate(metadata: Dictionary) -> Dictionary:
	if not _has_required_and_allowed_keys(metadata, REQUIRED_KEYS, ALLOWED_KEYS):
		return _result(false, "invalid_envelope")
	if str(metadata.get("schema", "")) != SCHEMA:
		return _result(false, "schema_mismatch")
	if not (metadata.get("run") is Dictionary) or (metadata.get("run") as Dictionary).is_empty() or not _is_json_value(metadata.get("run")):
		return _result(false, "invalid_run")
	if not (metadata.get("world") is Dictionary) or (metadata.get("world") as Dictionary).is_empty() or not _is_json_value(metadata.get("world")):
		return _result(false, "invalid_world")
	if not _is_vector(metadata.get("position")):
		return _result(false, "invalid_position")
	var camera_value: Variant = metadata.get("camera")
	if not (camera_value is Dictionary) or not _has_exact_keys(camera_value, CAMERA_KEYS):
		return _result(false, "invalid_camera")
	var camera: Dictionary = camera_value
	if not _is_vector(camera.get("position")) or not _is_finite_number(camera.get("fov")) or float(camera.get("fov")) <= 0.0 or float(camera.get("fov")) >= 180.0:
		return _result(false, "invalid_camera")
	var capture_value: Variant = metadata.get("capture")
	if not (capture_value is Dictionary) or not _has_exact_keys(capture_value, CAPTURE_KEYS):
		return _result(false, "invalid_capture")
	var capture: Dictionary = capture_value
	if not _is_positive_integer(capture.get("width")) or not _is_positive_integer(capture.get("height")):
		return _result(false, "invalid_capture")
	if not _is_utc_timestamp(metadata.get("captured_at")):
		return _result(false, "invalid_timestamp")
	if metadata.has("extensions") and not _is_json_value(metadata.get("extensions")):
		return _result(false, "invalid_extensions")
	var encoded := JSON.stringify(metadata)
	if encoded.to_utf8_buffer().size() > MAX_BYTES:
		return _result(false, "metadata_too_large")
	return _result(true, SCHEMA)

static func encode(metadata: Dictionary) -> String:
	if not bool(validate(metadata).get("valid", false)):
		return ""
	return JSON.stringify(metadata)

static func _has_required_and_allowed_keys(dictionary: Dictionary, required: Array, allowed: Array) -> bool:
	for key in required:
		if not dictionary.has(key):
			return false
	for key in dictionary:
		if not (key is String) or str(key) not in allowed:
			return false
	return true

static func _has_exact_keys(dictionary: Dictionary, expected: Array) -> bool:
	if dictionary.size() != expected.size():
		return false
	for key in expected:
		if not dictionary.has(key):
			return false
	return true

static func _is_vector(value: Variant) -> bool:
	if not (value is Array) or (value as Array).size() != 3:
		return false
	for component in value:
		if not _is_finite_number(component):
			return false
	return true

static func _is_utc_timestamp(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).length() != 20:
		return false
	var timestamp := str(value)
	if timestamp[4] != "-" or timestamp[7] != "-" or timestamp[10] != "T" or timestamp[13] != ":" or timestamp[16] != ":" or timestamp[19] != "Z":
		return false
	for index in range(timestamp.length()):
		if index in [4,7,10,13,16,19]:
			continue
		var code := timestamp.unicode_at(index)
		if code < 48 or code > 57:
			return false
	var parts := Time.get_datetime_dict_from_datetime_string(timestamp, false)
	return not parts.is_empty()

static func _is_finite_number(value: Variant) -> bool:
	if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
		return false
	return is_finite(float(value))

static func _is_positive_integer(value: Variant) -> bool:
	if not _is_finite_number(value):
		return false
	var number := float(value)
	return number > 0.0 and number == floor(number) and number <= 2147483647.0

static func _is_json_value(value: Variant, depth := 0) -> bool:
	if depth > MAX_NESTING_DEPTH:
		return false
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return true
		TYPE_ARRAY:
			for item in value:
				if not _is_json_value(item, depth + 1):
					return false
			return true
		TYPE_DICTIONARY:
			for key in value:
				if not (key is String) or not _is_json_value(value.get(key), depth + 1):
					return false
			return true
		_:
			return false

static func _result(valid: bool, status: String) -> Dictionary:
	return {"valid":valid,"status":status}
