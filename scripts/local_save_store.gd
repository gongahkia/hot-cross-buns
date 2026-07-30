extends RefCounted

const SAVE_SCHEMA := "save-envelope/v1"
const MAX_BYTES := 4 * 1024 * 1024

var primary_path: String
var backup_path: String
var staging_path: String

func _init(next_primary_path := "user://saves/expedition.save.json") -> void:
	primary_path = next_primary_path
	backup_path = primary_path + ".bak"
	staging_path = primary_path + ".tmp"

func save(payload: Dictionary) -> Dictionary:
	var existing := load_latest()
	var next_generation := int(existing.get("generation", 0)) + 1
	var envelope := {"schema": SAVE_SCHEMA, "generation": next_generation, "payload": payload}
	var write_result := _write_envelope(staging_path, envelope)
	if not bool(write_result.get("ok", false)):
		return write_result
	var staged := _read_envelope(staging_path)
	if not bool(staged.get("ok", false)):
		return {"ok": false, "error": "staging_validation_failed"}
	var current := _read_envelope(primary_path)
	if bool(current.get("ok", false)):
		var backup_error := DirAccess.copy_absolute(primary_path, backup_path)
		if backup_error != OK:
			return {"ok": false, "error": "backup_copy_failed", "code": backup_error}
	var promote_error := DirAccess.rename_absolute(staging_path, primary_path)
	if promote_error != OK:
		return {"ok": false, "error": "promotion_failed", "code": promote_error}
	return {"ok": true, "status": "saved", "generation": next_generation}

func load_latest() -> Dictionary:
	var best: Dictionary = {}
	for candidate_path in [primary_path, staging_path, backup_path]:
		var candidate := _read_envelope(candidate_path)
		if not bool(candidate.get("ok", false)):
			continue
		if best.is_empty() or int(candidate.get("generation", 0)) > int(best.get("generation", 0)):
			best = candidate
	if best.is_empty():
		return {"ok": false, "status": "missing_or_corrupt", "generation": 0}
	var source := str(best.get("source", ""))
	return {
		"ok": true,
		"status": "primary" if source == primary_path else "recovered",
		"source": source,
		"generation": int(best.get("generation", 0)),
		"payload": best.get("payload", {}).duplicate(true)
	}

func _write_envelope(path: String, envelope: Dictionary) -> Dictionary:
	var directory_error := DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	if directory_error != OK:
		return {"ok": false, "error": "directory_create_failed", "code": directory_error}
	var serialized := JSON.stringify(envelope)
	if serialized.to_utf8_buffer().size() > MAX_BYTES:
		return {"ok": false, "error": "save_too_large"}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "staging_open_failed", "code": FileAccess.get_open_error()}
	file.store_string(serialized)
	file.flush()
	file.close()
	return {"ok": true}

func _read_envelope(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "not_found"}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"ok": false, "error": "open_failed", "code": FileAccess.get_open_error()}
	if file.get_length() > MAX_BYTES:
		file.close()
		return {"ok": false, "error": "save_too_large"}
	var serialized := file.get_as_text()
	file.close()
	var json := JSON.new()
	if json.parse(serialized) != OK or not (json.data is Dictionary):
		return {"ok": false, "error": "invalid_json"}
	var envelope: Dictionary = json.data
	if str(envelope.get("schema", "")) != SAVE_SCHEMA:
		return {"ok": false, "error": "schema_mismatch"}
	var generation := int(envelope.get("generation", 0))
	if generation <= 0 or not (envelope.get("payload") is Dictionary):
		return {"ok": false, "error": "invalid_envelope"}
	return {"ok": true, "source": path, "generation": generation, "payload": envelope.get("payload")}
