class_name RunRecordSchema
extends RefCounted

const WORLD_GENERATOR := preload("res://scripts/world_generator.gd")
const RUN_DATA := preload("res://scripts/run_data.gd")
const CURRENT_SCHEMA := "run-record/v1"
const LEGACY_SCHEMA := "legacy-summary/v0"
const GENERATOR_SCHEMA_VERSION := WORLD_GENERATOR.GENERATOR_SCHEMA_VERSION
const RULESET_VERSION := RUN_DATA.RULESET_VERSION
const TICK_HZ := 60
const MAX_METADATA_BYTES := 64 * 1024
const MAX_NESTING_DEPTH := 32
const V1_KEYS := ["schema","world","ruleset_version","simulation","run","replay","integrity","metadata"]
const WORLD_KEYS := ["seed","generator_schema_version","generation_options"]
const SIMULATION_KEYS := ["tick_hz","start_tick"]
const RUN_KEYS := ["outcome","summary"]
const REPLAY_KEYS := ["input_spans","checkpoints"]
const INTEGRITY_KEYS := ["canonical_hash_algorithm","canonical_hash"]
const METADATA_KEYS := ["created_at","display_name","extensions"]
const SPAN_KEYS := ["start_tick","end_tick","actions","look_x","look_y"]
const CHECKPOINT_KEYS := ["tick","state_hash"]
const LEGACY_KEYS := ["level","seed","elapsed","collectibles","resources","regions","style","survival","outcome"]
const OUTCOMES := ["active","extracted","failed","abandoned"]

static func compatibility(record: Dictionary) -> Dictionary:
	if not record.has("schema"):
		return _legacy_compatibility(record)
	if str(record.get("schema", "")) != CURRENT_SCHEMA:
		return _result(false, "unsupported_schema")
	return _v1_compatibility(record, true)

static func canonical_authoritative_json(record: Dictionary) -> String:
	var validation := _v1_compatibility(record, false)
	if not bool(validation.get("compatible", false)):
		return ""
	return _canonical_json({"schema":record.get("schema"),"world":record.get("world"),"ruleset_version":record.get("ruleset_version"),"simulation":record.get("simulation"),"run":record.get("run"),"replay":record.get("replay")})

static func canonical_hash(record: Dictionary) -> String:
	var canonical := canonical_authoritative_json(record)
	if canonical.is_empty():
		return ""
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(canonical.to_utf8_buffer()) != OK:
		return ""
	return context.finish().hex_encode()

static func _legacy_compatibility(record: Dictionary) -> Dictionary:
	if not _has_exact_keys(record, LEGACY_KEYS):
		return _result(false, "invalid_legacy_record")
	if not _is_nonempty_string(record.get("level")) or typeof(record.get("seed")) != TYPE_INT or not _is_number(record.get("elapsed")) or float(record.get("elapsed")) < 0.0 or typeof(record.get("collectibles")) != TYPE_INT or int(record.get("collectibles")) < 0:
		return _result(false, "invalid_legacy_record")
	if not (record.get("resources") is Dictionary) or not _is_resource_totals(record.get("resources")) or not (record.get("regions") is Array) or not _is_string_array(record.get("regions")) or not (record.get("style") is Dictionary) or not (record.get("survival") is Dictionary) or str(record.get("outcome", "")) not in OUTCOMES:
		return _result(false, "invalid_legacy_record")
	return _result(true, LEGACY_SCHEMA)

static func _v1_compatibility(record: Dictionary, verify_hash: bool) -> Dictionary:
	if not _has_exact_keys(record, V1_KEYS):
		return _result(false, "invalid_v1_envelope")
	var world_value: Variant = record.get("world")
	if not (world_value is Dictionary) or not _has_exact_keys(world_value, WORLD_KEYS):
		return _result(false, "invalid_world_identity")
	var world: Dictionary = world_value
	if typeof(world.get("seed")) != TYPE_STRING or not _is_decimal_i64(str(world.get("seed"))) or str(world.get("generator_schema_version", "")) != GENERATOR_SCHEMA_VERSION:
		return _result(false, "generator_schema_version_mismatch")
	var options: Variant = world.get("generation_options")
	if not (options is Dictionary) or not _is_canonical_value(options):
		return _result(false, "invalid_generation_options")
	if str(record.get("ruleset_version", "")) != RULESET_VERSION:
		return _result(false, "ruleset_version_mismatch")
	var simulation_value: Variant = record.get("simulation")
	if not (simulation_value is Dictionary) or not _has_exact_keys(simulation_value, SIMULATION_KEYS):
		return _result(false, "invalid_simulation")
	var simulation: Dictionary = simulation_value
	if typeof(simulation.get("tick_hz")) != TYPE_INT or int(simulation.get("tick_hz")) != TICK_HZ or typeof(simulation.get("start_tick")) != TYPE_INT or int(simulation.get("start_tick")) < 0:
		return _result(false, "invalid_simulation")
	var run_value: Variant = record.get("run")
	if not (run_value is Dictionary) or not _has_exact_keys(run_value, RUN_KEYS):
		return _result(false, "invalid_run")
	var run: Dictionary = run_value
	if str(run.get("outcome", "")) not in OUTCOMES or not (run.get("summary") is Dictionary) or not _is_canonical_value(run.get("summary")):
		return _result(false, "invalid_run")
	var replay_value: Variant = record.get("replay")
	if not (replay_value is Dictionary) or not _has_exact_keys(replay_value, REPLAY_KEYS):
		return _result(false, "invalid_replay")
	var replay: Dictionary = replay_value
	if not (replay.get("input_spans") is Array) or not (replay.get("checkpoints") is Array) or not _valid_input_spans(replay.get("input_spans"), int(simulation.get("start_tick"))) or not _valid_checkpoints(replay.get("checkpoints"), int(simulation.get("start_tick"))):
		return _result(false, "invalid_replay")
	var integrity_value: Variant = record.get("integrity")
	if not (integrity_value is Dictionary) or not _has_exact_keys(integrity_value, INTEGRITY_KEYS):
		return _result(false, "invalid_integrity")
	var integrity: Dictionary = integrity_value
	if str(integrity.get("canonical_hash_algorithm", "")) != "sha256" or not _is_lower_hex_64(integrity.get("canonical_hash")):
		return _result(false, "invalid_integrity")
	var metadata_value: Variant = record.get("metadata")
	if not (metadata_value is Dictionary) or not _valid_metadata(metadata_value):
		return _result(false, "invalid_metadata")
	if verify_hash and str(integrity.get("canonical_hash")) != canonical_hash(record):
		return _result(false, "integrity_mismatch")
	return _result(true, CURRENT_SCHEMA)

static func _valid_input_spans(spans: Array, start_tick: int) -> bool:
	var next_tick := start_tick
	for value in spans:
		if not (value is Dictionary) or not _has_exact_keys(value, SPAN_KEYS):
			return false
		var span: Dictionary = value
		for key in SPAN_KEYS:
			if typeof(span.get(key)) != TYPE_INT:
				return false
		if int(span.get("start_tick")) != next_tick or int(span.get("end_tick")) < next_tick or int(span.get("actions")) < 0:
			return false
		next_tick = int(span.get("end_tick")) + 1
	return true

static func _valid_checkpoints(checkpoints: Array, start_tick: int) -> bool:
	var previous_tick := start_tick - 1
	for value in checkpoints:
		if not (value is Dictionary) or not _has_exact_keys(value, CHECKPOINT_KEYS):
			return false
		var checkpoint: Dictionary = value
		if typeof(checkpoint.get("tick")) != TYPE_INT or int(checkpoint.get("tick")) < start_tick or int(checkpoint.get("tick")) <= previous_tick or not _is_lower_hex_64(checkpoint.get("state_hash")):
			return false
		previous_tick = int(checkpoint.get("tick"))
	return true

static func _valid_metadata(metadata: Dictionary) -> bool:
	for key in metadata:
		if not (key is String) or str(key) not in METADATA_KEYS:
			return false
	if metadata.has("created_at") and not _is_nonempty_string(metadata.get("created_at")):
		return false
	if metadata.has("display_name") and not _is_nonempty_string(metadata.get("display_name")):
		return false
	if metadata.has("extensions"):
		var extensions: Variant = metadata.get("extensions")
		if not (extensions is Dictionary):
			return false
		for producer in extensions:
			if not _is_nonempty_string(producer) or not _is_json_value(extensions.get(producer)):
				return false
	return JSON.stringify(metadata).to_utf8_buffer().size() <= MAX_METADATA_BYTES

static func _is_resource_totals(resources: Dictionary) -> bool:
	for kind in resources:
		if not _is_nonempty_string(kind) or typeof(resources.get(kind)) != TYPE_INT or int(resources.get(kind)) < 0:
			return false
	return true

static func _is_string_array(values: Array) -> bool:
	for value in values:
		if not _is_nonempty_string(value):
			return false
	return true

static func _is_canonical_value(value: Variant, depth := 0) -> bool:
	if depth > MAX_NESTING_DEPTH:
		return false
	match typeof(value):
		TYPE_BOOL, TYPE_INT, TYPE_STRING:
			return true
		TYPE_ARRAY:
			for item in value:
				if not _is_canonical_value(item, depth + 1):
					return false
			return true
		TYPE_DICTIONARY:
			for key in value:
				if not _is_nonempty_string(key) or not _is_canonical_value(value.get(key), depth + 1):
					return false
			return true
		_:
			return false

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
				if not _is_nonempty_string(key) or not _is_json_value(value.get(key), depth + 1):
					return false
			return true
		_:
			return false

static func _canonical_json(value: Variant) -> String:
	match typeof(value):
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_STRING:
			return JSON.stringify(value)
		TYPE_ARRAY:
			var items: Array[String] = []
			for item in value:
				var encoded := _canonical_json(item)
				if encoded.is_empty():
					return ""
				items.append(encoded)
			return "[" + ",".join(items) + "]"
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			for key in keys:
				if not key is String:
					return ""
			keys.sort()
			var entries: Array[String] = []
			for key in keys:
				var encoded := _canonical_json(value.get(key))
				if encoded.is_empty():
					return ""
				entries.append(JSON.stringify(key) + ":" + encoded)
			return "{" + ",".join(entries) + "}"
		_:
			return ""

static func _is_decimal_i64(value: String) -> bool:
	if value.is_empty():
		return false
	var digits := value
	if value.begins_with("-"):
		digits = value.substr(1)
	if digits.is_empty() or (digits.length() > 1 and digits.begins_with("0")) or value == "-0":
		return false
	for index in range(digits.length()):
		var code := digits.unicode_at(index)
		if code < 48 or code > 57:
			return false
	return str(int(value)) == value

static func _is_lower_hex_64(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).length() != 64:
		return false
	for index in range(str(value).length()):
		var code := str(value).unicode_at(index)
		if not ((code >= 48 and code <= 57) or (code >= 97 and code <= 102)):
			return false
	return true

static func _has_exact_keys(dictionary: Dictionary, expected: Array) -> bool:
	if dictionary.size() != expected.size():
		return false
	for key in expected:
		if not dictionary.has(key):
			return false
	return true

static func _is_nonempty_string(value: Variant) -> bool:
	return typeof(value) == TYPE_STRING and not str(value).is_empty()

static func _is_number(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT

static func _result(compatible: bool, status: String) -> Dictionary:
	return {"compatible":compatible,"status":status}
