class_name GrappleImpact
extends RefCounted

static func resolve(speed: float, direction: Vector3) -> Vector3:
	if speed < 18.0 or direction.length() < 0.001: return Vector3.ZERO
	return direction.normalized()*lerpf(8.0, 18.0, clampf((speed-18.0)/16.0, 0.0, 1.0))
