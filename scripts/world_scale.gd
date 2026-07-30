class_name WorldScale
extends RefCounted

const DEFINITIONS := [
	{"id": "local", "factor": 1, "label": "local"},
	{"id": "region", "factor": 4, "label": "region"},
	{"id": "continent", "factor": 16, "label": "continent"},
]

static func info(scope: Variant = "local") -> Dictionary:
	for definition in DEFINITIONS:
		if scope is String and str(scope) == str(definition.id):
			return definition.duplicate()
		if scope is int and int(scope) == int(definition.factor):
			return definition.duplicate()
		if scope is float and is_equal_approx(float(scope), float(definition.factor)):
			return definition.duplicate()
	return DEFINITIONS[0].duplicate()

static func coordinate(value: float, scope: Variant = "local") -> float:
	var factor := int(info(scope).get("factor", 1))
	return value if factor == 1 else float(floori(value / float(factor)) * factor)

static func chunk_center(chunk: int, chunk_size: float, scope: Variant = "local") -> float:
	var factor := float(info(scope).get("factor", 1))
	return (float(chunk) + 0.5) * chunk_size * factor
