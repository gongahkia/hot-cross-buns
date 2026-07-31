class_name WorldMegastructureRouteValidator
extends RefCounted

const PLAYER := preload("res://scripts/player.gd")

const SCHEMA := "megastructure-route-envelope/v2"
const MODE_IDS := ["walk", "jump", "double_jump", "dash", "slide", "wall_run", "grapple", "glide", "drop"]

static func envelopes() -> Dictionary:
	return {"schema":SCHEMA,"unit":"world_unit","modes":[
		_ground("walk", 35.0),
		_air("jump", 6.0, 1.1, 3.0),
		_air("double_jump", 10.0, 2.1, 3.0),
		_air("dash", 3.0, 0.0, 3.0),
		_ground("slide", 25.0),
		_air("wall_run", 24.0, 0.0, 3.0),
		_air("grapple", 20.0, 16.0, 18.0, {"max_anchor_distance":26.0}),
		_air("glide", 60.0, 0.0, 18.0),
		_air("drop", 0.0, 0.0, 2.5),
	]}

static func envelope(mode: String) -> Dictionary:
	for record: Dictionary in envelopes().get("modes", []):
		if str(record.get("id", "")) == mode:
			return record.duplicate(true)
	return {}

static func _ground(id: String, max_slope_degrees: float) -> Dictionary:
	return {"id":id,"max_drop":0.0,"max_horizontal":0.0,"max_rise":0.0,"max_slope_degrees":max_slope_degrees,"requires_ground":true,"unbounded_horizontal":true}

static func _air(id: String, max_horizontal: float, max_rise: float, max_drop: float, extras := {}) -> Dictionary:
	var result := {"id":id,"max_drop":max_drop,"max_horizontal":max_horizontal,"max_rise":max_rise,"max_slope_degrees":0.0,"requires_ground":false,"unbounded_horizontal":false}
	for key: String in extras:
		result[key] = extras[key]
	return result
