class_name WorldD8Routing
extends RefCounted

const PRIORITY_FLOOD = preload("res://scripts/world_priority_flood.gd")

static func route(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	return PRIORITY_FLOOD.fill(region, options)
