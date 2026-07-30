extends SceneTree

const SAVE_STORE = preload("res://scripts/local_save_store.gd")
const TEST_PATH := "user://save-corruption-recovery-test/expedition.save.json"
var failed := false

func _initialize() -> void:
	_cleanup()
	var store = SAVE_STORE.new(TEST_PATH)
	_expect(bool(store.save({"run":"first"}).get("ok", false)) and bool(store.save({"run":"second"}).get("ok", false)), "save recovery setup failed")
	_write(store.primary_path, "{")
	_expect(bool(store._write_envelope(store.staging_path, {"schema":store.SAVE_SCHEMA,"generation":3,"payload":{"run":"interrupted"}}).get("ok", false)), "interrupted staging fixture failed")
	var staged: Dictionary = store.load_latest()
	_expect(str(staged.status) == "recovered" and int(staged.generation) == 3 and str((staged.payload as Dictionary).run) == "interrupted", "valid staged recovery drifted")
	_write(store.staging_path, JSON.stringify({"schema":"wrong","generation":4,"payload":{"run":"bad-schema"}}))
	var backup: Dictionary = store.load_latest()
	_expect(str(backup.status) == "recovered" and int(backup.generation) == 1 and str((backup.payload as Dictionary).run) == "first", "backup recovery after staged schema corruption drifted")
	_write(store.backup_path, "not-json")
	var missing: Dictionary = store.load_latest()
	_expect(not bool(missing.ok) and str(missing.status) == "missing_or_corrupt" and int(missing.generation) == 0, "all-corrupt save recovery drifted")
	_cleanup()
	quit(1 if failed else 0)

func _write(path: String, value: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	_expect(file != null, "corruption fixture could not open " + path)
	if file:
		file.store_string(value)
		file.flush()
		file.close()

func _cleanup() -> void:
	for path in [TEST_PATH, TEST_PATH + ".bak", TEST_PATH + ".tmp"]:
		if FileAccess.file_exists(path):
			_expect(DirAccess.remove_absolute(path) == OK, "test cleanup failed")

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
