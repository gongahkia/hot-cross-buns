class_name LevelLibrary
extends RefCounted

static func all_levels() -> Array:
	return [
		level("sandbox", "Sandbox", 0.0, "Free play. Chain movement, test every tool, and chase style.", "full style kit", 150.0, 116.0, "summit")
	]

static func level(id: String, title: String, par: float, briefing: String, focus: String, world_length: float, world_width: float, terrain_style: String) -> Dictionary:
	return {
		"id": id,
		"title": title,
		"par": par,
		"briefing": briefing,
		"focus": focus,
		"world_length": world_length,
		"world_width": world_width,
		"terrain_style": terrain_style
	}

static func by_id(level_id: String) -> Dictionary:
	for level in all_levels():
		if level.id == level_id:
			return level
	return all_levels()[0]
