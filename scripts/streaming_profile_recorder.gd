class_name StreamingProfileRecorder
extends RefCounted

const SCHEMA := "streaming-profile/v1"
const DIRECTORY := "user://profiles"
const MAX_HITCHES := 512

var active := false
var started_at := ""
var started_usec := 0
var metadata: Dictionary = {}
var samples: Array = []
var hitches: Array = []

func begin(next_metadata: Dictionary = {}) -> void:
	active = true
	started_at = Time.get_datetime_string_from_system(true)
	started_usec = Time.get_ticks_usec()
	metadata = next_metadata.duplicate(true)
	samples.clear()
	hitches.clear()

func elapsed_seconds() -> float:
	return float(Time.get_ticks_usec() - started_usec) / 1000000.0 if active else 0.0

func record_sample(fps: float, frame_ms: float, diagnostics: Dictionary, position: Vector3, region: Dictionary) -> void:
	if not active:
		return
	var refresh: Dictionary = diagnostics.get("refresh", {})
	var telemetry: Dictionary = diagnostics.get("telemetry", {})
	var memory: Dictionary = diagnostics.get("memory", {})
	samples.append({"t":elapsed_seconds(),"fps":fps,"frame_ms":frame_ms,"position":{"x":position.x,"y":position.y,"z":position.z},"region":{"id":str(region.get("id", "")),"name":str(region.get("name", "")),"family":str(region.get("family", ""))},"stream":{"refresh":refresh.duplicate(true),"hitches":int(telemetry.get("hitches", 0)),"max_refresh_ms":float(telemetry.get("max_refresh_ms", 0.0)),"memory":memory.duplicate(true)}})

func record_hitch(sample: Dictionary) -> void:
	if not active:
		return
	var record := sample.duplicate(true)
	record["t"] = elapsed_seconds()
	hitches.append(record)
	if hitches.size() > MAX_HITCHES:
		hitches.pop_front()

func finish() -> Dictionary:
	if not active:
		return {}
	var duration := elapsed_seconds()
	active = false
	return {"schema":SCHEMA,"started_at":started_at,"duration_seconds":duration,"metadata":metadata.duplicate(true),"summary":_summary(duration),"samples":samples.duplicate(true),"hitches":hitches.duplicate(true)}

func export() -> String:
	var profile := finish()
	if profile.is_empty():
		return ""
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DIRECTORY)) != OK:
		return ""
	var stamp := Time.get_datetime_string_from_system().replace(":", "-").replace("T", "_")
	var path := DIRECTORY.path_join("streaming_" + stamp + ".json")
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return ""
	file.store_string(JSON.stringify(profile, "\t"))
	file.close()
	return ProjectSettings.globalize_path(path)

func _summary(duration: float) -> Dictionary:
	var fps_total := 0.0
	var min_fps := INF
	var max_frame_ms := 0.0
	for sample: Dictionary in samples:
		var fps := float(sample.get("fps", 0.0))
		fps_total += fps
		min_fps = minf(min_fps, fps)
		max_frame_ms = maxf(max_frame_ms, float(sample.get("frame_ms", 0.0)))
	return {"sample_count":samples.size(),"hitch_count":hitches.size(),"average_fps":fps_total / float(samples.size()) if not samples.is_empty() else 0.0,"minimum_fps":min_fps if not samples.is_empty() else 0.0,"maximum_frame_ms":max_frame_ms,"duration_seconds":duration}
