class_name LevelLibrary
extends RefCounted

static func all_levels() -> Array:
	var catalog: Array = [
		level("sandbox", "Sandbox", 0.0, "Free play. Chain movement, test every tool, and chase style.", "full style kit", 150.0, 116.0, "summit")
	]
	var directory: DirAccess = DirAccess.open("res://levels")
	if directory == null:
		return catalog
	var files: PackedStringArray = directory.get_files()
	files.sort()
	for file_name in files:
		if not file_name.ends_with(".level.json") or file_name == "sandbox.level.json":
			continue
		var path: String = "res://levels/" + file_name
		var file: FileAccess = FileAccess.open(path, FileAccess.READ)
		if file == null:
			continue
		var parsed: Variant = JSON.parse_string(file.get_as_text())
		if not parsed is Dictionary or str(parsed.get("schema", "")) != "a_slow_walk.level.v1":
			continue
		var world: Dictionary = parsed.get("world", {})
		catalog.append(level(str(parsed.get("id", file_name.get_basename())), str(parsed.get("title", "Untitled Level")), 0.0, str(parsed.get("briefing", "Creative level.")), str(parsed.get("focus", "full style kit")), float(world.get("length", 96.0)), float(world.get("width", 96.0)), str(world.get("terrain_style", "summit")), path))
	return catalog

static func level(id: String, title: String, par: float, briefing: String, focus: String, world_length: float, world_width: float, terrain_style: String, document_path := "") -> Dictionary:
	var result := {
		"id": id,
		"title": title,
		"par": par,
		"briefing": briefing,
		"focus": focus,
		"world_length": world_length,
		"world_width": world_width,
		"terrain_style": terrain_style
	}
	if not document_path.is_empty():
		result["document_path"] = document_path
	return result

static func by_id(level_id: String) -> Dictionary:
	for level in all_levels():
		if level.id == level_id:
			return level
	return all_levels()[0]
