class_name RunExport
extends RefCounted

const SCHEMA := "a-slow-walk.export.v1"
const WORLD_GENERATOR := preload("res://scripts/world_generator.gd")
const GENERATOR_SCHEMA_VERSION := WORLD_GENERATOR.GENERATOR_SCHEMA_VERSION
const EXPORT_DIRECTORY := "user://exports"
const RUN_CARD_RENDERER := preload("res://scripts/run_card_renderer.gd")

static func seed_payload(seed: int) -> Dictionary:
	return {"schema":SCHEMA,"type":"seed","world":world_identity(seed)}

static func run_card_payload(record: Dictionary) -> Dictionary:
	var seed := int(record.get("seed", 0))
	return {"schema":SCHEMA,"type":"run-card","world":world_identity(seed),"run":{"id":int(record.get("id", 0)),"outcome":str(record.get("outcome", "")),"level":str(record.get("level", "")),"elapsed":float(record.get("elapsed", 0.0)),"collectibles":int(record.get("collectibles", 0)),"resources":(record.get("resources", {}) as Dictionary).duplicate(true),"regions":(record.get("regions", []) as Array).duplicate(true),"survival":(record.get("survival", {}) as Dictionary).duplicate(true)}}

static func photo_payload(image_path: String, metadata_path: String, metadata: Dictionary) -> Dictionary:
	var run: Dictionary = metadata.get("run", {}) as Dictionary
	return {"schema":SCHEMA,"type":"photo","world":world_identity(int(run.get("seed", 0))),"photo":{"image":image_path.get_file(),"metadata":metadata_path.get_file()},"capture":metadata.duplicate(true)}

static func world_identity(seed: int) -> Dictionary:
	return {"seed":str(seed),"generator_schema_version":GENERATOR_SCHEMA_VERSION,"generation_options":{}}

static func export_seed(seed: int) -> String:
	return _write_json("seed-%s" % str(seed), seed_payload(seed))

static func export_run_card(record: Dictionary) -> String:
	if record.is_empty(): return ""
	var path := _write_json("run-card-%04d" % int(record.get("id", 0)), run_card_payload(record))
	if path.is_empty(): return ""
	var image := FileAccess.open(path.get_basename() + ".svg", FileAccess.WRITE)
	if image:
		image.store_string(RUN_CARD_RENDERER.render(run_card_payload(record)))
		image.close()
	return path

static func export_photo(image_path: String, metadata_path: String) -> Dictionary:
	if not FileAccess.file_exists(image_path) or not FileAccess.file_exists(metadata_path): return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(metadata_path))
	if not parsed is Dictionary: return {}
	var directory := EXPORT_DIRECTORY.path_join("photos")
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory)) != OK: return {}
	var image_destination := _unique_path(directory, image_path.get_file().get_basename(), ".png")
	var metadata_destination := image_destination.get_basename() + ".json"
	if not _copy_file(image_path, image_destination) or not _copy_file(metadata_path, metadata_destination): return {}
	var manifest := _write_json("photo-" + image_destination.get_file().get_basename(), photo_payload(image_destination, metadata_destination, parsed))
	return {"image":image_destination,"metadata":metadata_destination,"manifest":manifest}

static func _write_json(stem: String, payload: Dictionary) -> String:
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(EXPORT_DIRECTORY)) != OK: return ""
	var path := _unique_path(EXPORT_DIRECTORY, stem, ".json")
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null: return ""
	file.store_string(JSON.stringify(payload, "\t", true))
	file.close()
	return path

static func _copy_file(source: String, destination: String) -> bool:
	var input := FileAccess.open(source, FileAccess.READ)
	var output := FileAccess.open(destination, FileAccess.WRITE)
	if input == null or output == null: return false
	output.store_buffer(input.get_buffer(input.get_length()))
	input.close()
	output.close()
	return true

static func _unique_path(directory: String, stem: String, extension: String) -> String:
	var path := directory.path_join(stem + extension)
	var index := 2
	while FileAccess.file_exists(path):
		path = directory.path_join("%s-%d%s" % [stem,index,extension])
		index += 1
	return path
