class_name WildlifeEnvironment
extends RefCounted

static func evaluate(surface: Dictionary) -> Dictionary:
	if bool(surface.get("water", false)): return {"can_move":false,"speed_multiplier":0.0,"reason":"water"}
	var slope := clampf(float(surface.get("slope", 0.0)), 0.0, 1.0)
	return {"can_move":true,"speed_multiplier":lerpf(1.0, 0.45, slope),"reason":"terrain"}
