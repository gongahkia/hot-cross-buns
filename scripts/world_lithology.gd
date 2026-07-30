class_name WorldLithology
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")
const TABLE := {
	0: {"name": "unknown", "density": 2.7, "erodibility_k": 1.0, "albedo": 0.25},
	1: {"name": "basalt", "density": 3.0, "erodibility_k": 0.6, "albedo": 0.18},
	2: {"name": "granite", "density": 2.65, "erodibility_k": 0.5, "albedo": 0.32},
	3: {"name": "gneiss", "density": 2.75, "erodibility_k": 0.4, "albedo": 0.3},
	4: {"name": "carbonate", "density": 2.7, "erodibility_k": 1.4, "albedo": 0.48},
	5: {"name": "sandstone", "density": 2.3, "erodibility_k": 0.9, "albedo": 0.42},
	6: {"name": "shale", "density": 2.4, "erodibility_k": 1.2, "albedo": 0.24},
	7: {"name": "evaporite", "density": 2.2, "erodibility_k": 1.6, "albedo": 0.62},
}

static func properties(id: int) -> Dictionary:
	var props: Dictionary = TABLE.get(id, TABLE[0])
	return props.duplicate(true)

static func classify(seed: int, plate: Dictionary, world_x: float, world_z: float, latitude_unit: float, rainfall: float, elevation: float, sea_level: float, shield: float = 0.0, craton: float = 0.0, rift_valley: float = 0.0, island_arc: float = 0.0) -> Dictionary:
	var age := float(plate.get("age", 0.0))
	var boundary := float(plate.get("boundary", 0.0))
	if str(plate.get("crust", "")) == "oceanic":
		if age < 0.1:
			return _result(1, age)
		if age > 0.7:
			return _result(6, age)
		if elevation < sea_level - 0.18 and boundary < 0.18:
			return _result(0, age)
		if island_arc > 0.2 or boundary > 0.45:
			return _result(1, age)
		return _result(5, age)
	if shield + craton > 0.5:
		return _result(2 if RNG.unit_at(seed, floori(world_x), floori(world_z), 1031) < 0.5 else 3, age)
	if boundary < 0.24 and latitude_unit < 0.5 and rainfall > 0.16:
		return _result(4, age)
	if rainfall < 0.18 and boundary < 0.35:
		return _result(5, age)
	if boundary > 0.5 or rift_valley > 0.28:
		return _result(3 if RNG.unit_at(seed, floori(world_x), floori(world_z), 1031) < 0.55 else 2, age)
	return _result(6 if rainfall > 0.55 else 5, age)

static func apply(cell: Dictionary, id: int, age: Variant = null) -> Dictionary:
	var result := properties(id)
	cell["lithology"] = id
	cell["erodibility_k"] = float(result.erodibility_k)
	cell["lithology_age"] = float(age) if age != null else float(cell.get("lithology_age", 0.0))
	return cell

static func refine(cell: Dictionary) -> Dictionary:
	var down_cell: Variant = cell.get("down_cell", null)
	if not bool(cell.get("water", false)) and down_cell == null and float(cell.get("rainfall", 0.0)) < 0.12:
		apply(cell, 7, cell.get("lithology_age", 0.0))
	return cell

static func _result(id: int, age: float) -> Dictionary:
	var result := properties(id)
	result["id"] = id
	result["age"] = age
	return result
