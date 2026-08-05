class_name LevelDocument
extends RefCounted

const SCHEMA := "a_slow_walk.level.v1"
const DRAFT_DIR := "res://levels/_drafts"
const PUBLISHED_DIR := "res://levels"
const HISTORY_LIMIT := 100
const SNAPSHOT_INTERVAL := 10
const PLAYTEST_LIMIT := 20
const MODULE_KINDS := ["platform", "wall", "ramp", "boost", "launch", "grapple_anchor", "recharge", "collectible", "reset", "gap", "sign", "building", "climbable_trunk", "root_arch", "route_marker", "checkpoint"]

var data: Dictionary = {}
var undo_stack: Array[Dictionary] = []
var redo_stack: Array[Dictionary] = []
var last_error := ""

static func create_blank(level_id := "creative-draft", title := "Creative Draft") -> Variant:
	var document: Variant = load("res://scripts/level_document.gd").new()
	document.data = {"schema": SCHEMA, "version": 1, "id": level_id, "title": title, "briefing": "Local creative draft.", "focus": "full style kit", "status": "draft", "revision": 0, "world": {"width": 96.0, "length": 96.0, "terrain_style": "summit"}, "spawn": [0.0, 1.1, 3.0], "modules": [], "routes": [], "references": [], "assumptions": [], "history": []}
	return document

static func from_data(raw: Dictionary) -> Variant:
	var document: Variant = load("res://scripts/level_document.gd").new()
	document.data = raw.duplicate(true)
	document._normalize()
	return document

static func load_from_path(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		var missing: Variant = create_blank()
		missing.last_error = "Level file not found: " + path
		return missing
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		var unreadable: Variant = create_blank()
		unreadable.last_error = "Could not open level file: " + path
		return unreadable
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		var invalid: Variant = create_blank()
		invalid.last_error = "Level file is not a JSON object: " + path
		return invalid
	return from_data(parsed)

func duplicate_document() -> Variant:
	return from_data(data)

func save_to_path(path: String) -> Error:
	_normalize()
	var directory_error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
	if directory_error != OK:
		last_error = "Could not create level directory: " + path.get_base_dir()
		return directory_error
	var temporary_path := path + ".tmp"
	var file := FileAccess.open(temporary_path, FileAccess.WRITE)
	if file == null:
		last_error = "Could not write level file: " + path
		return FileAccess.get_open_error()
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	var rename_error := DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary_path), ProjectSettings.globalize_path(path))
	if rename_error != OK:
		last_error = "Could not atomically replace level file: " + path
		return rename_error
	if path.begins_with(DRAFT_DIR):
		_ensure_history_baseline()
	return OK

func draft_path() -> String:
	return DRAFT_DIR.path_join(_safe_id()) + ".level.json"

func published_path() -> String:
	return PUBLISHED_DIR.path_join(_safe_id()) + ".level.json"

func publish() -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var conflict := draft_conflict()
	if not bool(conflict.get("ok", false)):
		_release_draft_lock()
		return conflict
	data["status"] = "reviewed" if str(data.get("status", "draft")) != "approved" else "approved"
	var error := save_to_path(published_path())
	_release_draft_lock()
	return {"ok": error == OK, "path": published_path(), "error": last_error}

func save_draft() -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var conflict := draft_conflict()
	if not bool(conflict.get("ok", false)):
		_release_draft_lock()
		return conflict
	var error := save_to_path(draft_path())
	_release_draft_lock()
	return {"ok": error == OK, "error": last_error, "path": draft_path()}

func apply_transaction(transaction: Dictionary) -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _apply_transaction_locked(transaction)
	_release_draft_lock()
	return result

func _apply_transaction_locked(transaction: Dictionary) -> Dictionary:
	var action := str(transaction.get("action", ""))
	if action.is_empty():
		return {"ok": false, "error": "Transaction action is required."}
	if transaction.has("expected_revision") and int(transaction.get("expected_revision", -1)) != int(data.get("revision", 0)):
		return _conflict(int(transaction.get("expected_revision", -1)))
	var disk: Variant = _read_json(draft_path())
	if disk is Dictionary and int(disk.get("revision", 0)) != int(data.get("revision", 0)):
		return _conflict(int(data.get("revision", 0)), int(disk.get("revision", 0)))
	if not FileAccess.file_exists(draft_path()):
		var baseline_error := save_to_path(draft_path())
		if baseline_error != OK: return {"ok": false, "error": last_error}
	var snapshot := data.duplicate(true)
	var result := _apply(action, transaction)
	if not bool(result.get("ok", false)):
		return result
	undo_stack.append(snapshot)
	redo_stack.clear()
	return _commit(snapshot, transaction, result)

func undo() -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _undo_locked()
	_release_draft_lock()
	return result

func _undo_locked() -> Dictionary:
	if undo_stack.is_empty():
		return {"ok": false, "error": "No creative edit to undo."}
	var snapshot: Dictionary = undo_stack.pop_back()
	redo_stack.append(data.duplicate(true))
	var previous := data.duplicate(true)
	data = snapshot.duplicate(true)
	return _commit(previous, {"action": "rollback", "target_revision": int(snapshot.get("revision", 0))}, {"ok": true, "rolled_back_to": int(snapshot.get("revision", 0))})

func redo() -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _redo_locked()
	_release_draft_lock()
	return result

func _redo_locked() -> Dictionary:
	if redo_stack.is_empty():
		return {"ok": false, "error": "No creative edit to redo."}
	var snapshot: Dictionary = redo_stack.pop_back()
	undo_stack.append(data.duplicate(true))
	var previous := data.duplicate(true)
	data = snapshot.duplicate(true)
	return _commit(previous, {"action": "redo", "target_revision": int(snapshot.get("revision", 0))}, {"ok": true, "redone_to": int(snapshot.get("revision", 0))})

func rollback_to_revision(target_revision: int, expected_revision := -1) -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _rollback_to_revision_locked(target_revision, expected_revision)
	_release_draft_lock()
	return result

func _rollback_to_revision_locked(target_revision: int, expected_revision := -1) -> Dictionary:
	if expected_revision >= 0 and expected_revision != int(data.get("revision", 0)):
		return _conflict(expected_revision)
	var target: Variant = _materialize_revision(target_revision)
	if not target is Dictionary:
		return {"ok": false, "error": "Revision snapshot was not found."}
	var previous := data.duplicate(true)
	data = (target as Dictionary).duplicate(true)
	_normalize()
	return _commit(previous, {"action": "rollback", "target_revision": target_revision}, {"ok": true, "rolled_back_to": target_revision})

func revision_history() -> Array:
	var manifest: Variant = _read_json(_manifest_path())
	if manifest is Dictionary and manifest.get("revisions", []) is Array:
		return manifest.get("revisions", [])
	return data.get("history", []) if data.get("history", []) is Array else []

func revision_diff(revision: int) -> Dictionary:
	var value: Variant = _read_json(_change_path(revision))
	return value if value is Dictionary else {}

func refresh_from_draft() -> Dictionary:
	if not FileAccess.file_exists(draft_path()):
		return {"ok": false, "error": "Draft file was not found."}
	var latest: Variant = load_from_path(draft_path())
	if latest.last_error != "": return {"ok": false, "error": latest.last_error}
	data = latest.data.duplicate(true)
	undo_stack.clear()
	redo_stack.clear()
	return {"ok": true, "revision": int(data.get("revision", 0)), "changed_module_ids": ["*"], "full_rebuild": true}

func draft_conflict() -> Dictionary:
	var disk: Variant = _read_json(draft_path())
	if disk is Dictionary and int(disk.get("revision", 0)) != int(data.get("revision", 0)):
		return _conflict(int(data.get("revision", 0)), int(disk.get("revision", 0)))
	return {"ok": true}

func module_by_id(module_id: String) -> Dictionary:
	for module in modules():
		if module is Dictionary and str(module.get("id", "")) == module_id:
			return module
	return {}

func modules() -> Array:
	var raw: Variant = data.get("modules", [])
	return raw if raw is Array else []

func validation_report() -> Dictionary:
	var errors: Array[String] = []
	var warnings: Array[String] = []
	var error_codes: Array[String] = []
	var warning_codes: Array[String] = []
	if str(data.get("schema", "")) != SCHEMA:
		_add_finding(errors, error_codes, "schema.unsupported", "Unsupported level schema.")
	if str(data.get("id", "")).is_empty():
		_add_finding(errors, error_codes, "level.id_required", "Level id is required.")
	var world: Variant = data.get("world", {})
	var world_data: Dictionary = world if world is Dictionary else {}
	var width := float(world_data.get("width", 0.0))
	var length := float(world_data.get("length", 0.0))
	if width <= 0.0 or length <= 0.0:
		_add_finding(errors, error_codes, "world.invalid_dimensions", "World width and length must be positive.")
	var ids: Dictionary = {}
	var listed_modules := modules()
	if listed_modules.is_empty():
		_add_finding(warnings, warning_codes, "modules.empty", "Draft has no modules.")
	for module in listed_modules:
		if not module is Dictionary:
			_add_finding(errors, error_codes, "module.not_object", "Module entry is not an object.")
			continue
		var module_id := str(module.get("id", ""))
		var kind := str(module.get("kind", ""))
		if module_id.is_empty() or ids.has(module_id):
			_add_finding(errors, error_codes, "module.id_invalid", "Module ids must be unique and non-empty.")
		ids[module_id] = true
		if not MODULE_KINDS.has(kind):
			_add_finding(errors, error_codes, "module.kind_unknown", "Unknown module kind: " + kind)
		var position: Variant = vector_from(module.get("position", []))
		if position == null:
			_add_finding(errors, error_codes, "module.position_invalid", "Module " + module_id + " has no valid position.")
			continue
		if absf(position.x) > width * 0.5 or position.z > 16.0 or position.z < -length:
			_add_finding(warnings, warning_codes, "module.out_of_bounds", "Module " + module_id + " is outside world bounds.")
		if bool(module.get("estimated", false)) or str(module.get("confidence", "")) == "estimated":
			_add_finding(warnings, warning_codes, "module.estimated", "Module " + module_id + " uses estimated reference geometry.")
	if vector_from(data.get("spawn", [])) == null:
		_add_finding(errors, error_codes, "spawn.invalid", "Spawn must be a three-number vector.")
	if not _has_kind("reset"):
		_add_finding(warnings, warning_codes, "reset.missing", "Draft has no reset pad.")
	var assumptions: Variant = data.get("assumptions", [])
	if assumptions is Array and not assumptions.is_empty():
		_add_finding(warnings, warning_codes, "assumptions.unconfirmed", "Draft contains unconfirmed scale or layout assumptions.")
	_validate_routes(ids, warnings, warning_codes)
	_validate_references(warnings, warning_codes)
	_validate_overlaps(warnings, warning_codes)
	return {"schema": SCHEMA, "level_id": str(data.get("id", "")), "revision": int(data.get("revision", 0)), "errors": errors, "warnings": warnings, "error_codes": error_codes, "warning_codes": warning_codes, "status": str(data.get("status", "draft")), "manual_approval_required": true}

static func vector_from(value: Variant) -> Variant:
	if value is Vector3:
		return value
	if not value is Array or value.size() != 3:
		return null
	for item in value:
		if not item is float and not item is int:
			return null
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

static func vector_data(value: Vector3) -> Array:
	return [value.x, value.y, value.z]

func save_playtest_report(report: Dictionary) -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _save_playtest_report_locked(report)
	_release_draft_lock()
	return result

func _save_playtest_report_locked(report: Dictionary) -> Dictionary:
	var run := report.duplicate(true)
	run["level_id"] = str(data.get("id", "creative-draft"))
	run["revision"] = int(data.get("revision", 0))
	run["completed"] = true
	run["saved_at"] = Time.get_datetime_string_from_system(true)
	var root := _playtest_dir()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(root))
	var name := "run-" + str(Time.get_unix_time_from_system()).replace(".", "-") + ".json"
	var path := root.path_join(name)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "Could not save playtest report."}
	file.store_string(JSON.stringify(run, "\t"))
	_prune_files(root, PLAYTEST_LIMIT)
	return {"ok": true, "path": path, "report": run}

func playtest_reports() -> Array:
	var directory := DirAccess.open(_playtest_dir())
	if directory == null:
		return []
	var files := directory.get_files()
	files.sort()
	files.reverse()
	var reports: Array = []
	for name in files:
		if name.ends_with(".json"):
			var report: Variant = _read_json(_playtest_dir().path_join(name))
			if report is Dictionary:
				reports.append(report)
	return reports

func approve_with_evidence(report: Dictionary) -> Dictionary:
	var lock := _acquire_draft_lock()
	if not bool(lock.get("ok", false)): return lock
	var result := _approve_with_evidence_locked(report)
	_release_draft_lock()
	return result

func _approve_with_evidence_locked(report: Dictionary) -> Dictionary:
	if int(report.get("revision", -1)) != int(data.get("revision", 0)) or not bool(report.get("completed", false)):
		return {"ok": false, "error": "Approval needs a completed playtest for the current revision."}
	var reached: Dictionary = {}
	for value in report.get("checkpoints", []):
		reached[str(value)] = true
	for module in modules():
		if module is Dictionary and str(module.get("kind", "")) == "checkpoint" and not reached.has(str(module.get("id", ""))):
			return {"ok": false, "error": "Approval needs every authored checkpoint."}
	var previous := data.duplicate(true)
	data["status"] = "approved"
	return _commit(previous, {"action": "manual_approve", "report": str(report.get("saved_at", ""))}, {"ok": true, "status": "approved"})

func _apply(action: String, transaction: Dictionary) -> Dictionary:
	match action:
		"add_module":
			var module: Variant = transaction.get("module", {})
			if not module is Dictionary or str(module.get("kind", "")) not in MODULE_KINDS:
				return {"ok": false, "error": "add_module requires a known module kind."}
			var next: Dictionary = module.duplicate(true)
			if str(next.get("id", "")).is_empty():
				next["id"] = _next_module_id(str(next.get("kind", "module")))
			if not module_by_id(str(next.get("id", ""))).is_empty() or vector_from(next.get("position", [])) == null:
				return {"ok": false, "error": "Module id exists or position is invalid."}
			var additions := modules()
			additions.append(next)
			data["modules"] = additions
			return {"ok": true, "module_id": str(next.get("id", ""))}
		"update_module":
			var target := str(transaction.get("module_id", ""))
			var patch: Variant = transaction.get("patch", {})
			if not patch is Dictionary:
				return {"ok": false, "error": "update_module requires a patch."}
			var changed := false
			var updated := modules()
			for index in range(updated.size()):
				var existing: Dictionary = updated[index]
				if str(existing.get("id", "")) == target:
					for key in patch:
						if key != "id": existing[key] = patch[key]
					if vector_from(existing.get("position", [])) == null: return {"ok": false, "error": "Module position must be [x, y, z]."}
					updated[index] = existing
					changed = true
					break
			if not changed: return {"ok": false, "error": "Module was not found."}
			data["modules"] = updated
			return {"ok": true, "module_id": target}
		"remove_module":
			var remove_target := str(transaction.get("module_id", ""))
			var before := modules()
			var remaining: Array = []
			for module in before:
				if module is Dictionary and str(module.get("id", "")) != remove_target: remaining.append(module)
			if remaining.size() == before.size(): return {"ok": false, "error": "Module was not found."}
			data["modules"] = remaining
			return {"ok": true, "module_id": remove_target, "removed": true}
		"duplicate_module":
			var source := module_by_id(str(transaction.get("module_id", "")))
			if source.is_empty(): return {"ok": false, "error": "Module was not found."}
			var copy := source.duplicate(true)
			copy["id"] = _next_module_id(str(copy.get("kind", "module")))
			var offset: Variant = vector_from(transaction.get("offset", [1.5, 0.0, 1.5]))
			copy["position"] = vector_data(vector_from(copy.get("position", [0.0, 0.0, 0.0])) + (offset if offset != null else Vector3(1.5, 0.0, 1.5)))
			var duplicates := modules(); duplicates.append(copy); data["modules"] = duplicates
			return {"ok": true, "module_id": str(copy.get("id", ""))}
		"set_metadata":
			var metadata: Variant = transaction.get("patch", {})
			if not metadata is Dictionary: return {"ok": false, "error": "set_metadata requires a patch."}
			for key in metadata:
				if key not in ["schema", "modules", "history", "status"]: data[key] = metadata[key]
			if metadata.has("references"):
				return {"ok": true, "references_changed": true, "changed_module_ids": ["@reference:*"]}
			if metadata.has("world"):
				return {"ok": true, "full_rebuild": true, "changed_module_ids": ["*"]}
			return {"ok": true, "changed_module_ids": []}
		"add_reference":
			var reference: Variant = transaction.get("reference", {})
			if not reference is Dictionary or str(reference.get("path", "")).is_empty(): return {"ok": false, "error": "add_reference requires a path."}
			var refs: Array = data.get("references", []) if data.get("references", []) is Array else []
			var next_ref: Dictionary = reference.duplicate(true)
			if str(next_ref.get("id", "")).is_empty(): next_ref["id"] = "reference-" + str(refs.size() + 1)
			refs.append(next_ref); data["references"] = refs
			return {"ok": true, "reference_id": str(next_ref.get("id", "")), "references_changed": true}
		"remove_reference":
			var reference_id := str(transaction.get("reference_id", ""))
			var refs: Array = data.get("references", []) if data.get("references", []) is Array else []
			var kept: Array = []
			for reference in refs:
				if reference is Dictionary and str(reference.get("id", "")) != reference_id: kept.append(reference)
			if kept.size() == refs.size(): return {"ok": false, "error": "Reference was not found."}
			data["references"] = kept
			return {"ok": true, "reference_id": reference_id, "references_changed": true}
		"set_status":
			var status := str(transaction.get("status", "draft"))
			if status not in ["draft", "reviewed"]: return {"ok": false, "error": "Only draft or reviewed may be set by transactions."}
			data["status"] = status
			return {"ok": true, "status": status}
	return {"ok": false, "error": "Unknown transaction action: " + action}

func _commit(previous: Dictionary, transaction: Dictionary, result: Dictionary) -> Dictionary:
	data["revision"] = int(previous.get("revision", 0)) + 1
	var changed := _changed_ids(transaction, result)
	var record := {"id": str(transaction.get("id", "txn-" + str(data["revision"]))), "action": str(transaction.get("action", "edit")), "revision": int(data["revision"]), "changed_module_ids": changed, "target_revision": transaction.get("target_revision", null)}
	var history: Array = data.get("history", []) if data.get("history", []) is Array else []
	history.append(record)
	data["history"] = history
	var save_error := save_to_path(draft_path())
	if save_error != OK: return {"ok": false, "error": last_error}
	_record_history(previous, record)
	result["revision"] = int(data["revision"])
	result["changed_module_ids"] = changed
	result["path"] = draft_path()
	return result

func _record_history(previous: Dictionary, record: Dictionary) -> void:
	var root := _history_dir()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(root.path_join("snapshots")))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(root.path_join("changes")))
	var manifest: Variant = _read_json(_manifest_path())
	if not manifest is Dictionary or not manifest.get("revisions", []) is Array or (manifest.get("revisions", []) as Array).is_empty():
		_write_json(_snapshot_path(int(previous.get("revision", 0))), previous)
	if int(data["revision"]) % SNAPSHOT_INTERVAL == 0 or str(record.get("action", "")) == "rollback":
		_write_json(_snapshot_path(int(data["revision"])), data)
	_write_json(_change_path(int(data["revision"])), _compact_diff(previous, data, record))
	if not manifest is Dictionary: manifest = {"revisions": []}
	var revisions: Array = manifest.get("revisions", []) if manifest.get("revisions", []) is Array else []
	revisions.append(record)
	while revisions.size() > HISTORY_LIMIT:
		revisions.pop_front()
	_prune_history_files(revisions)
	manifest["revisions"] = revisions
	_write_json(_manifest_path(), manifest)

func _compact_diff(before: Dictionary, after: Dictionary, record: Dictionary) -> Dictionary:
	var before_modules := _module_map(before)
	var after_modules := _module_map(after)
	var ids: Dictionary = {}
	for module_id in before_modules: ids[module_id] = true
	for module_id in after_modules: ids[module_id] = true
	var modules: Dictionary = {}
	for module_id in ids:
		if before_modules.get(module_id, null) != after_modules.get(module_id, null):
			modules[module_id] = {"before": before_modules.get(module_id, null), "after": after_modules.get(module_id, null)}
	var metadata: Dictionary = {}
	for key in after:
		if key not in ["modules", "history", "revision"] and before.get(key, null) != after[key]: metadata[key] = after[key]
	var order: Array = []
	for module in after.get("modules", []):
		if module is Dictionary: order.append(str(module.get("id", "")))
	return {"revision": int(after["revision"]), "before_revision": int(before.get("revision", 0)), "action": record.get("action", "edit"), "changed_module_ids": record.get("changed_module_ids", []), "metadata": metadata, "modules": modules, "module_order": order}

func _module_map(document: Dictionary) -> Dictionary:
	var result: Dictionary = {}
	for module in document.get("modules", []):
		if module is Dictionary and not str(module.get("id", "")).is_empty(): result[str(module.get("id", ""))] = module
	return result

func _materialize_revision(target_revision: int) -> Variant:
	var directory := DirAccess.open(_history_dir().path_join("snapshots"))
	if directory == null: return null
	var base_revision := -1
	for file_name in directory.get_files():
		if file_name.ends_with(".level.json"):
			var revision := int(file_name.get_basename().get_basename())
			if revision <= target_revision and revision > base_revision: base_revision = revision
	if base_revision < 0: return null
	var state: Variant = _read_json(_snapshot_path(base_revision))
	if not state is Dictionary: return null
	var history := revision_history()
	for record in history:
		if not record is Dictionary or int(record.get("revision", 0)) <= base_revision or int(record.get("revision", 0)) > target_revision: continue
		var change: Variant = _read_json(_change_path(int(record.get("revision", 0))))
		if not change is Dictionary: return null
		if change.has("after") and change.get("after") is Dictionary:
			state = change.get("after").duplicate(true)
			continue
		for key in change.get("metadata", {}): state[key] = change.get("metadata", {})[key]
		var modules := _module_map(state)
		for module_id in change.get("modules", {}):
			var patch: Dictionary = change.get("modules", {})[module_id]
			if patch.get("after", null) == null: modules.erase(module_id)
			else: modules[module_id] = patch.get("after")
		var ordered: Array = []
		for module_id in change.get("module_order", []):
			if modules.has(str(module_id)): ordered.append(modules[str(module_id)])
		state["modules"] = ordered
		state["revision"] = int(change.get("revision", 0))
	state["history"] = history.filter(func(record): return int(record.get("revision", 0)) <= target_revision)
	return state

func _prune_history_files(revisions: Array) -> void:
	if revisions.is_empty(): return
	var oldest := int((revisions[0] as Dictionary).get("revision", 0))
	var directory := DirAccess.open(_history_dir().path_join("snapshots"))
	if directory == null: return
	var base := -1
	for file_name in directory.get_files():
		if file_name.ends_with(".level.json"):
			var revision := int(file_name.get_basename().get_basename())
			if revision < oldest and revision > base: base = revision
	if base < 0: base = oldest
	for file_name in directory.get_files():
		if file_name.ends_with(".level.json") and int(file_name.get_basename().get_basename()) < base:
			DirAccess.remove_absolute(ProjectSettings.globalize_path(_history_dir().path_join("snapshots").path_join(file_name)))
	var changes := DirAccess.open(_history_dir().path_join("changes"))
	if changes:
		for file_name in changes.get_files():
			if file_name.ends_with(".json") and int(file_name.get_basename()) < oldest:
				DirAccess.remove_absolute(ProjectSettings.globalize_path(_history_dir().path_join("changes").path_join(file_name)))

func _ensure_history_baseline() -> void:
	if not FileAccess.file_exists(_manifest_path()):
		var revision := int(data.get("revision", 0))
		_write_json(_snapshot_path(revision), data)
		_write_json(_manifest_path(), {"revisions": []})

func _conflict(expected_revision: int, current_revision := -1) -> Dictionary:
	var changed: Array = []
	for record in revision_history():
		if record is Dictionary and int(record.get("revision", 0)) > expected_revision:
			for module_id in record.get("changed_module_ids", []):
				if not changed.has(module_id): changed.append(module_id)
	var current := int(data.get("revision", 0)) if current_revision < 0 else current_revision
	return {"ok": false, "conflict": true, "error": "Draft revision is stale. Refresh before editing.", "expected_revision": expected_revision, "current_revision": current, "changed_module_ids": changed}

func _changed_ids(transaction: Dictionary, result: Dictionary) -> Array:
	if result.has("changed_module_ids"): return result.get("changed_module_ids", [])
	if result.has("module_id"): return [str(result.get("module_id", ""))]
	if result.has("reference_id"): return ["@reference:" + str(result.get("reference_id", ""))]
	return ["*"]

func _normalize() -> void:
	if data.is_empty(): data = create_blank().data
	if not data.has("schema"): data["schema"] = SCHEMA
	if not data.has("version"): data["version"] = 1
	if not data.has("id"): data["id"] = "creative-draft"
	if not data.has("title"): data["title"] = "Creative Draft"
	if not data.has("status"): data["status"] = "draft"
	if not data.has("revision"): data["revision"] = 0
	if not data.has("world"): data["world"] = {"width": 96.0, "length": 96.0, "terrain_style": "summit"}
	if not data.has("spawn"): data["spawn"] = [0.0, 1.1, 3.0]
	for key in ["modules", "routes", "references", "assumptions", "history"]:
		if not data.has(key): data[key] = []

func _safe_id() -> String:
	var safe := str(data.get("id", "creative-draft")).to_lower().validate_filename().replace(" ", "-")
	return safe if not safe.is_empty() else "creative-draft"

func _next_module_id(kind: String) -> String:
	var prefix := kind.to_lower().validate_filename().replace(" ", "-")
	var index := 1
	while not module_by_id(prefix + "-" + str(index)).is_empty(): index += 1
	return prefix + "-" + str(index)

func _has_kind(kind: String) -> bool:
	for module in modules():
		if module is Dictionary and str(module.get("kind", "")) == kind: return true
	return false

func _validate_routes(ids: Dictionary, warnings: Array[String], codes: Array[String]) -> void:
	var routes: Variant = data.get("routes", [])
	if not routes is Array:
		_add_finding(warnings, codes, "route.invalid_collection", "Routes must be an array.")
		return
	for route in routes:
		if not route is Dictionary:
			_add_finding(warnings, codes, "route.not_object", "Route entry is not an object.")
			continue
		var members: Variant = route.get("modules", [])
		if not members is Array or members.size() < 2:
			_add_finding(warnings, codes, "route.insufficient_members", "Route " + str(route.get("id", "unnamed")) + " has fewer than two markers.")
			continue
		for member in members:
			if not ids.has(str(member)):
				_add_finding(warnings, codes, "route.missing_module", "Route " + str(route.get("id", "unnamed")) + " references a missing module.")

func _validate_references(warnings: Array[String], codes: Array[String]) -> void:
	var references: Variant = data.get("references", [])
	if not references is Array:
		_add_finding(warnings, codes, "reference.invalid_collection", "References must be an array.")
		return
	for reference in references:
		if not reference is Dictionary or str(reference.get("path", "")).is_empty():
			_add_finding(warnings, codes, "reference.invalid", "Reference is missing a path.")

func _validate_overlaps(warnings: Array[String], codes: Array[String]) -> void:
	var geometry: Array = []
	for module in modules():
		if module is Dictionary and str(module.get("kind", "")) in ["platform", "wall", "building", "climbable_trunk"]: geometry.append(module)
	for first_index in range(geometry.size()):
		var first: Dictionary = geometry[first_index]
		var first_position: Variant = vector_from(first.get("position", []))
		if first_position == null: continue
		var first_size := _module_size(first)
		for second_index in range(first_index + 1, geometry.size()):
			var second: Dictionary = geometry[second_index]
			var second_position: Variant = vector_from(second.get("position", []))
			if second_position == null: continue
			var second_size := _module_size(second)
			if absf(first_position.y - second_position.y) < (first_size.y + second_size.y) * 0.5 and _oriented_rectangles_overlap(first_position, first_size, float(first.get("rotation_y", 0.0)), second_position, second_size, float(second.get("rotation_y", 0.0))):
				_add_finding(warnings, codes, "geometry.overlap", "Geometry overlaps: " + str(first.get("id", "")) + " / " + str(second.get("id", "")))

func _oriented_rectangles_overlap(first_position: Vector3, first_size: Vector3, first_rotation: float, second_position: Vector3, second_size: Vector3, second_rotation: float) -> bool:
	var axes := [_axis_x(first_rotation), _axis_z(first_rotation), _axis_x(second_rotation), _axis_z(second_rotation)]
	var delta := Vector2(second_position.x - first_position.x, second_position.z - first_position.z)
	for axis in axes:
		var distance := absf(delta.dot(axis))
		var reach := _projection_radius(first_size, first_rotation, axis) + _projection_radius(second_size, second_rotation, axis)
		if distance >= reach: return false
	return true

func _axis_x(rotation: float) -> Vector2:
	return Vector2(cos(rotation), -sin(rotation))

func _axis_z(rotation: float) -> Vector2:
	return Vector2(sin(rotation), cos(rotation))

func _projection_radius(size: Vector3, rotation: float, axis: Vector2) -> float:
	return size.x * 0.5 * absf(_axis_x(rotation).dot(axis)) + size.z * 0.5 * absf(_axis_z(rotation).dot(axis))

func _module_size(module: Dictionary) -> Vector3:
	var value: Variant = vector_from(module.get("size", [4.0, 0.8, 4.0]))
	return value if value != null else Vector3(4.0, 0.8, 4.0)

func _history_dir() -> String:
	return DRAFT_DIR.path_join(".history").path_join(_safe_id())

func _snapshot_path(revision: int) -> String:
	return _history_dir().path_join("snapshots").path_join(str(revision) + ".level.json")

func _change_path(revision: int) -> String:
	return _history_dir().path_join("changes").path_join(str(revision) + ".json")

func _manifest_path() -> String:
	return _history_dir().path_join("manifest.json")

func _playtest_dir() -> String:
	return DRAFT_DIR.path_join(".playtests").path_join(_safe_id())

func _lock_dir() -> String:
	return DRAFT_DIR.path_join(".locks").path_join(_safe_id() + ".lock")

func _acquire_draft_lock() -> Dictionary:
	var lock_path := _lock_dir()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(lock_path.get_base_dir()))
	var result := DirAccess.make_dir_absolute(ProjectSettings.globalize_path(lock_path))
	if result == OK:
		_write_json(lock_path.path_join("owner.json"), {"owner": "godot", "created_at": Time.get_unix_time_from_system()})
		return {"ok": true}
	if result == ERR_ALREADY_EXISTS:
		var owner_path := lock_path.path_join("owner.json")
		if FileAccess.file_exists(owner_path) and Time.get_unix_time_from_system() - FileAccess.get_modified_time(owner_path) > 15:
			DirAccess.remove_absolute(ProjectSettings.globalize_path(owner_path))
			DirAccess.remove_absolute(ProjectSettings.globalize_path(lock_path))
			return _acquire_draft_lock()
		return {"ok": false, "locked": true, "error": "Draft is busy; retry after refreshing."}
	return {"ok": false, "error": "Could not acquire draft lock."}

func _release_draft_lock() -> void:
	var lock_path := _lock_dir()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(lock_path.path_join("owner.json")))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(lock_path))

func _write_json(path: String, value: Variant) -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(value, "\t"))
		file.close()

func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path): return null
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text()) if file else null

func _prune_files(path: String, limit: int) -> void:
	var directory := DirAccess.open(path)
	if directory == null: return
	var files: PackedStringArray = directory.get_files(); files.sort()
	while files.size() > limit:
		var oldest := files[0]
		files.remove_at(0)
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path.path_join(oldest)))

func _add_finding(messages: Array[String], codes: Array[String], code: String, message: String) -> void:
	if not codes.has(code):
		codes.append(code)
		messages.append(message)
