class_name WildlifeArchetypes
extends RefCounted

const RECORDS := {
	"swift_deer":{"id":"swift_deer","name":"Swift deer","families":["wilderness","overgrown_suburb"],"mobility":"ground","awareness_range":28.0,"flee_distance":44.0,"territorial":false},
	"ruin_fox":{"id":"ruin_fox","name":"Ruin fox","families":["reclaimed_city","industrial_ruin","overgrown_suburb"],"mobility":"ground","awareness_range":22.0,"flee_distance":36.0,"territorial":false},
	"territorial_boar":{"id":"territorial_boar","name":"Territorial boar","families":["wilderness","overgrown_suburb"],"mobility":"ground","awareness_range":20.0,"flee_distance":32.0,"territorial":true,"territory_radius":12.0}
}

static func all() -> Array:
	var records: Array = []
	for id: String in RECORDS.keys(): records.append((RECORDS[id] as Dictionary).duplicate(true))
	records.sort_custom(func(left: Dictionary, right: Dictionary): return str(left.id) < str(right.id))
	return records

static func by_id(id: String) -> Dictionary:
	return (RECORDS.get(id, {}) as Dictionary).duplicate(true)
