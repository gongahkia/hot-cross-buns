class_name PhotoCameraControls
extends RefCounted

const MIN_SPEED := 2.0
const MAX_SPEED := 72.0
const MIN_SENSITIVITY := 0.00025
const MAX_SENSITIVITY := 0.016

static func direction(planar: Vector2, ascend: bool, descend: bool) -> Vector3:
	return Vector3(planar.x, float(ascend) - float(descend), planar.y)

static func speed(base_speed: float, fast: bool, precise: bool) -> float:
	return base_speed * (2.5 if fast else 0.25 if precise else 1.0)

static func next_speed(current: float, direction: int) -> float:
	return clampf(current * (2.0 if direction > 0 else 0.5), MIN_SPEED, MAX_SPEED)

static func next_sensitivity(current: float, direction: int) -> float:
	return clampf(current * (2.0 if direction > 0 else 0.5), MIN_SENSITIVITY, MAX_SENSITIVITY)

static func clamp_pitch(value: float) -> float:
	return clampf(value, deg_to_rad(-88.0), deg_to_rad(88.0))
