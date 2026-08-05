class_name PhotoVisualControls
extends RefCounted

const FILTERS := [{"name":"natural","brightness":1.0,"contrast":1.0,"saturation":1.0},{"name":"muted","brightness":0.96,"contrast":0.92,"saturation":0.68},{"name":"amber","brightness":1.05,"contrast":1.08,"saturation":0.82},{"name":"vivid","brightness":1.02,"contrast":1.12,"saturation":1.28}]

static func defaults(fov_value: float) -> Dictionary:
	return {"fov":clampf(fov_value, 22.0, 110.0),"exposure":1.0,"focus_distance":24.0,"blur_amount":0.0,"filter_index":0}

static func fov(current: float, direction: int) -> float:
	return clampf(current + float(direction) * 4.0, 22.0, 110.0)

static func exposure(current: float, direction: int) -> float:
	return clampf(current + float(direction) * 0.1, 0.4, 2.5)

static func focus_distance(current: float, direction: int) -> float:
	return clampf(current + float(direction) * 2.0, 2.0, 160.0)

static func blur_amount(current: float, direction: int) -> float:
	return clampf(current + float(direction) * 0.05, 0.0, 1.0)

static func next_filter(index: int) -> int:
	return posmod(index + 1, FILTERS.size())

static func filter(index: int) -> Dictionary:
	return (FILTERS[posmod(index, FILTERS.size())] as Dictionary).duplicate(true)
