extends Node

const SAVE_PATH := "user://a_slow_walk_runs.json"
const HISTORY_LIMIT := 60

var records: Dictionary = {}
var active_level_id := ""
var elapsed := 0.0
var collected := 0
var running := false
var _run_frames: Array = []

func _ready() -> void:
	load_records()

func load_records() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	var parsed = JSON.parse_string(file.get_as_text())
	if parsed is Dictionary:
		records = parsed

func save_records() -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	file.store_string(JSON.stringify(records))

func begin_run(level_id: String) -> void:
	active_level_id = level_id
	elapsed = 0.0
	collected = 0
	_run_frames.clear()
	running = true

func advance(delta: float) -> void:
	if running:
		elapsed += delta

func record_frame(position: Vector3, yaw: float, pitch: float, sliding: bool) -> void:
	if not running:
		return
	_run_frames.append({"p": [position.x, position.y, position.z], "yaw": yaw, "pitch": pitch, "slide": sliding})

func add_collectible() -> void:
	if running:
		collected += 1

func get_record(level_id: String) -> Dictionary:
	if not records.has(level_id):
		records[level_id] = {"best_time": -1.0, "collectibles": 0, "ghost": [], "history": []}
	return records[level_id]

func finish_run() -> Dictionary:
	if not running:
		return {}
	running = false
	var record := get_record(active_level_id)
	var old_best := float(record.get("best_time", -1.0))
	var is_pb := old_best < 0.0 or elapsed < old_best
	if is_pb:
		record["best_time"] = elapsed
		record["ghost"] = _run_frames.duplicate(true)
	var history := _history_from_record(record)
	history.append(elapsed)
	while history.size() > HISTORY_LIMIT:
		history.pop_front()
	record["history"] = history
	record["collectibles"] = max(int(record.get("collectibles", 0)), collected)
	records[active_level_id] = record
	save_records()
	return {"time": elapsed, "is_pb": is_pb, "collectibles": collected, "best_time": float(record.get("best_time", -1.0)), "attempts": history.size()}

func ghost_for(level_id: String) -> Array:
	return get_record(level_id).get("ghost", [])

func best_time_for(level_id: String) -> float:
	return float(get_record(level_id).get("best_time", -1.0))

func collectible_best_for(level_id: String) -> int:
	return int(get_record(level_id).get("collectibles", 0))

func attempt_history_for(level_id: String) -> Array[float]:
	return _history_from_record(get_record(level_id))

func _history_from_record(record: Dictionary) -> Array[float]:
	var history: Array[float] = []
	var raw_history = record.get("history", [])
	if raw_history is Array:
		for value in raw_history:
			var time := float(value)
			if time >= 0.0:
				history.append(time)
	return history
