class_name LevelLibrary
extends RefCounted

static func all_levels() -> Array:
	return [
		level("01-trailhead", "Trailhead", 45.0, "Learn the summit line: jump, double-jump, then choose a landing.", "jump + double-jump", 62.0, 38.0, "fern"),
		level("02-moss-run", "Moss Run", 52.0, "Follow the visible moss lane; carry boosts through its turns.", "boost carry", 70.0, 44.0, "moss"),
		level("03-canopy-gap", "Canopy Gap", 58.0, "Dash between the marked canopy islands. The basin catches misses.", "air dash", 74.0, 46.0, "canopy"),
		level("04-root-tunnel", "Root Tunnel", 60.0, "Hold slide through the root chute to keep the fast line alive.", "slide carry", 78.0, 44.0, "root"),
		level("05-sky-sap", "Sky Sap", 65.0, "Launch pads open the high line; every landing has a recovery route.", "launch pads", 82.0, 48.0, "sap"),
		level("06-wild-line", "Wild Line", 72.0, "Wall-jump the marked trunks, or use the longer ridge below.", "wall jump", 86.0, 50.0, "wild"),
		level("07-green-light", "Green Light", 88.0, "Read the whole basin. Chain your full movement kit into the finale.", "full kit", 92.0, 54.0, "summit")
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
