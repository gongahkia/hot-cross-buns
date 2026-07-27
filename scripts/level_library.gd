class_name LevelLibrary
extends RefCounted

static func all_levels() -> Array:
	return [
		level("01-trailhead", "Trailhead", 45.0, "Reach the summit by any route.", 54.0, 0.0, false, false),
		level("02-moss-run", "Moss Run", 52.0, "Boost through the open moss basin.", 67.0, 1.0, true, false),
		level("03-canopy-gap", "Canopy Gap", 58.0, "Climb the ridge or weave through canopy.", 78.0, 2.0, false, false),
		level("04-root-tunnel", "Root Tunnel", 60.0, "Use the safe switchbacks or take the ridge.", 82.0, -1.0, true, false),
		level("05-sky-sap", "Sky Sap", 65.0, "Launch into the high canopy route.", 90.0, 0.0, false, true),
		level("06-wild-line", "Wild Line", 72.0, "Chain boost pads across the fastest ascent.", 102.0, 3.0, true, true),
		level("07-green-light", "Green Light", 88.0, "Choose a route, then find a faster one.", 125.0, -2.0, true, true)
	]

static func level(id: String, title: String, par: float, briefing: String, length: float, offset: float, boosts: bool, launches: bool) -> Dictionary:
	return {"id": id, "title": title, "par": par, "briefing": briefing, "length": length, "offset": offset, "boosts": boosts, "launches": launches}

static func by_id(level_id: String) -> Dictionary:
	for level in all_levels():
		if level.id == level_id:
			return level
	return all_levels()[0]
