extends Node

const STYLE_RUN := preload("res://scripts/style_run.gd")
const SAVE_PATH := "user://a_slow_walk_runs.json"
const HISTORY_LIMIT := 60

var records: Dictionary = {}
var active_level_id := ""
var elapsed := 0.0
var collected := 0
var running := false
var _run_frames: Array = []
var style: StyleRun = STYLE_RUN.new()
var style_movement_active := false

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
	style.begin()
	style_movement_active = false
	running = true

func advance(delta: float) -> Dictionary:
	if not running:
		return style.snapshot()
	elapsed += delta
	style.update_movement_multiplier(delta, style_movement_active)
	return style.tick(elapsed)

func set_style_movement_active(active: bool) -> void:
	style_movement_active = active

func record_frame(position: Vector3, yaw: float, pitch: float, sliding: bool) -> void:
	if not running:
		return
	_run_frames.append({"p": [position.x, position.y, position.z], "yaw": yaw, "pitch": pitch, "slide": sliding})

func add_collectible() -> void:
	if running:
		collected += 1

func add_style_action(action: String, override_points := -1, gap_id := "") -> Dictionary:
	if not running:
		return style.snapshot()
	return style.add_action(action, elapsed, override_points, gap_id)

func style_land() -> Dictionary:
	if not running:
		return style.snapshot()
	return style.land(elapsed)

func bail_style() -> Dictionary:
	if not running:
		return style.snapshot()
	return style.bail()

func style_snapshot() -> Dictionary:
	return style.snapshot()

func get_record(level_id: String) -> Dictionary:
	if not records.has(level_id):
		records[level_id] = _new_record()
	else:
		records[level_id] = _normalized_record(records[level_id])
	return records[level_id]

func finish_run() -> Dictionary:
	if not running:
		return {}
	running = false
	var record := get_record(active_level_id)
	var style_result := style.finish(elapsed)
	var old_best := float(record.get("best_time", -1.0))
	var is_pb := old_best < 0.0 or elapsed < old_best
	var style_score := int(style_result.banked)
	var old_best_style := int(record.get("best_style", 0))
	var is_style_pb := style_score > old_best_style
	if is_pb:
		record["best_time"] = elapsed
		record["ghost"] = _run_frames.duplicate(true)
	var history := _history_from_record(record)
	history.append(elapsed)
	while history.size() > HISTORY_LIMIT:
		history.pop_front()
	record["history"] = history
	var style_history := _style_history_from_record(record)
	style_history.append(style_score)
	while style_history.size() > HISTORY_LIMIT:
		style_history.pop_front()
	record["style_history"] = style_history
	if is_style_pb:
		record["best_style"] = style_score
	record["best_combo"] = max(int(record.get("best_combo", 0)), int(style_result.longest_combo))
	record["collectibles"] = max(int(record.get("collectibles", 0)), collected)
	records[active_level_id] = record
	save_records()
	return {
		"time": elapsed,
		"is_pb": is_pb,
		"collectibles": collected,
		"best_time": float(record.get("best_time", -1.0)),
		"attempts": history.size(),
		"style": style_score,
		"is_style_pb": is_style_pb,
		"best_style": int(record.get("best_style", 0)),
		"longest_combo": int(style_result.longest_combo),
		"finish_bonus": StyleRun.FINISH_BONUS
	}

func ghost_for(level_id: String) -> Array:
	return get_record(level_id).get("ghost", [])

func best_time_for(level_id: String) -> float:
	return float(get_record(level_id).get("best_time", -1.0))

func collectible_best_for(level_id: String) -> int:
	return int(get_record(level_id).get("collectibles", 0))

func attempt_history_for(level_id: String) -> Array[float]:
	return _history_from_record(get_record(level_id))

func best_style_for(level_id: String) -> int:
	return int(get_record(level_id).get("best_style", 0))

func best_combo_for(level_id: String) -> int:
	return int(get_record(level_id).get("best_combo", 0))

func style_history_for(level_id: String) -> Array[int]:
	return _style_history_from_record(get_record(level_id))

func _history_from_record(record: Dictionary) -> Array[float]:
	var history: Array[float] = []
	var raw_history = record.get("history", [])
	if raw_history is Array:
		for value in raw_history:
			var time := float(value)
			if time >= 0.0:
				history.append(time)
	return history

func _style_history_from_record(record: Dictionary) -> Array[int]:
	var history: Array[int] = []
	var raw_history = record.get("style_history", [])
	if raw_history is Array:
		for value in raw_history:
			var score := int(value)
			if score >= 0:
				history.append(score)
	return history

func _new_record() -> Dictionary:
	return {"best_time": -1.0, "collectibles": 0, "ghost": [], "history": [], "best_style": 0, "best_combo": 0, "style_history": []}

func _normalized_record(raw_record: Variant) -> Dictionary:
	var record: Dictionary = raw_record if raw_record is Dictionary else {}
	for key in _new_record():
		if not record.has(key):
			record[key] = _new_record()[key]
	return record
