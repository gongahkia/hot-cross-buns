class_name SlideImpact
extends RefCounted

const MIN_SPEED := 12.0
const MAX_SPEED := 28.0
const MIN_IMPULSE := 6.0
const MAX_IMPULSE := 16.0

static func resolve(speed: float, direction: Vector3) -> Vector3:
	if speed < MIN_SPEED or direction.length() < 0.001: return Vector3.ZERO
	var strength := lerpf(MIN_IMPULSE, MAX_IMPULSE, clampf((speed-MIN_SPEED)/(MAX_SPEED-MIN_SPEED), 0.0, 1.0))
	return direction.normalized()*strength
