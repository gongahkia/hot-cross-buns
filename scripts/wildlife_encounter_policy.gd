class_name WildlifeEncounterPolicy
extends RefCounted

static func decide(archetype: Dictionary, context: Dictionary = {}) -> Dictionary:
	if archetype.is_empty(): return {"state":"idle","reason":"unknown_archetype"}
	var distance := maxf(0.0, float(context.get("player_distance", INF)))
	var awareness := maxf(0.0, float(archetype.get("awareness_range", 0.0)))
	if not bool(context.get("has_line_of_sight", true)) or distance > awareness: return {"state":"idle","reason":"unaware"}
	if bool(archetype.get("territorial", false)) and bool(context.get("territory_intrusion", false)) and not bool(context.get("warning_issued", false)):
		return {"state":"warn","reason":"territory","flee_distance":float(archetype.get("flee_distance", 0.0))}
	return {"state":"flee","reason":"player_nearby","flee_distance":float(archetype.get("flee_distance", 0.0))}
