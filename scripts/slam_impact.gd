class_name SlamImpact
extends RefCounted

const MIN_SPEED := 16.0
const MAX_SPEED := 38.0
const MIN_IMPULSE := 10.0
const MAX_IMPULSE := 24.0

static func resolve(speed: float, origin: Vector3, target: Vector3) -> Vector3:
	var direction := target-origin
	direction.y = 0.0
	if speed < MIN_SPEED or direction.length() < 0.001: return Vector3.ZERO
	var strength := lerpf(MIN_IMPULSE, MAX_IMPULSE, clampf((speed-MIN_SPEED)/(MAX_SPEED-MIN_SPEED), 0.0, 1.0))
	return direction.normalized()*strength
