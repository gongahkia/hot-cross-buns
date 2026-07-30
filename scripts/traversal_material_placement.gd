class_name TraversalMaterialPlacement
extends RefCounted

const MARKER_COST := {"wood": 1, "fiber": 1}
const MAX_PLANAR_SPEED := 3.0
const MAX_SLOPE := 0.35
const MAX_DISTANCE := 2.5

static func evaluate(player: Dictionary, surface: Dictionary, inventory: Dictionary) -> Dictionary:
	var result := {"allowed": false, "reason": "unknown", "cost": MARKER_COST.duplicate()}
	if not bool(player.get("on_floor", false)):
		result.reason = "grounded_required"
		return result
	if bool(player.get("traversal_active", false)) or float(player.get("planar_speed", 0.0)) > MAX_PLANAR_SPEED:
		result.reason = "stabilize_required"
		return result
	if float(surface.get("distance", INF)) > MAX_DISTANCE:
		result.reason = "target_too_far"
		return result
	if bool(surface.get("water", false)) or float(surface.get("slope", 0.0)) > MAX_SLOPE:
		result.reason = "unsafe_surface"
		return result
	for kind: String in MARKER_COST:
		if int(inventory.get(kind, 0)) < int(MARKER_COST[kind]):
			result.reason = "materials_required"
			return result
	result.allowed = true
	result.reason = "ready"
	return result
