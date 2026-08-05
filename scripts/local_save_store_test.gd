extends SceneTree

const SAVE_STORE := preload("res://scripts/local_save_store.gd")
const TEST_PATH := "user://save-store-test/expedition.save.json"

func _initialize() -> void:
	_cleanup()
	var store = SAVE_STORE.new(TEST_PATH)
	var first := {"run": "first", "resources": {"wood": 2}}
	var first_write: Dictionary = store.save(first)
	assert(bool(first_write.get("ok", false)), "first save failed")
	var first_load: Dictionary = store.load_latest()
	assert(str(first_load.get("status", "")) == "primary", "first save did not load from primary")
	var first_payload: Dictionary = first_load.get("payload", {})
	assert(str(first_payload.get("run", "")) == "first", "first save run changed")
	assert(int(first_payload.get("resources", {}).get("wood", 0)) == 2, "first save resources changed")
	var second := {"run": "second", "resources": {"water": 1}}
	var second_write: Dictionary = store.save(second)
	assert(bool(second_write.get("ok", false)), "second save failed")
	var file := FileAccess.open(TEST_PATH, FileAccess.WRITE)
	assert(file != null, "corruption fixture could not open primary")
	file.store_string("{")
	file.flush()
	file.close()
	var recovered: Dictionary = store.load_latest()
	assert(str(recovered.get("status", "")) == "recovered", "backup was not selected after corruption")
	var recovered_payload: Dictionary = recovered.get("payload", {})
	assert(str(recovered_payload.get("run", "")) == "first", "recovery did not return last known-good run")
	assert(int(recovered_payload.get("resources", {}).get("wood", 0)) == 2, "recovery did not return last known-good resources")
	_cleanup()
	quit()

func _cleanup() -> void:
	for path in [TEST_PATH, TEST_PATH + ".bak", TEST_PATH + ".tmp"]:
		if FileAccess.file_exists(path):
			var remove_error := DirAccess.remove_absolute(path)
			assert(remove_error == OK, "test cleanup failed")
