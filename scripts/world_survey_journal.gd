class_name WorldSurveyJournal
extends RefCounted

var regions: Dictionary = {}
var landmarks: Dictionary = {}

func survey_region(region: Dictionary) -> bool:
	var id := str(region.get("id", ""))
	if id.is_empty() or regions.has(id): return false
	regions[id] = {"id":id,"name":str(region.get("name", "Unknown")),"family":str(region.get("family", "wilderness"))}
	return true

func survey_landmark(record: Dictionary) -> bool:
	var id := str(record.get("id", ""))
	if id.is_empty() or landmarks.has(id): return false
	landmarks[id] = {"id":id,"name":str(record.get("name", record.get("kind", "Landmark"))),"kind":str(record.get("kind", "")),"taxonomy":str(record.get("taxonomy", ""))}
	return true

func snapshot() -> Dictionary:
	return {"regions":_entries(regions),"landmarks":_entries(landmarks)}

func _entries(source: Dictionary) -> Array:
	var ids: Array = source.keys()
	ids.sort()
	var entries: Array = []
	for id in ids: entries.append((source[id] as Dictionary).duplicate(true))
	return entries
