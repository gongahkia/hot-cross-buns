class_name TraversalMelee
extends RefCounted

const REQUIREMENTS := {"slide":{"speed":12.0,"range":2.2},"slam":{"speed":16.0,"range":3.0}}

static func hit(state: String, speed: float, origin: Vector3, target: Vector3) -> Dictionary:
	var requirement: Dictionary = REQUIREMENTS.get(state, {})
	if requirement.is_empty(): return {"hit":false,"reason":"inactive"}
	if speed < float(requirement.speed): return {"hit":false,"reason":"insufficient_speed"}
	var distance := origin.distance_to(target)
	var did_hit := distance <= float(requirement.range) + 0.0001
	return {"hit":did_hit,"reason":"hit" if did_hit else "out_of_range","range":float(requirement.range),"distance":distance}
