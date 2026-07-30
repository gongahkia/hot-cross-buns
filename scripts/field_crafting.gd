class_name FieldCrafting
extends RefCounted

const RECIPES := {"water_filter": {"inputs": {"scrap": 1, "fiber": 1, "dirty_water": 1}, "outputs": {"water": 1}}}

static func recipe(id: String) -> Dictionary:
	return (RECIPES.get(id, {}) as Dictionary).duplicate(true)

static func can_craft(materials: Dictionary, id: String) -> bool:
	var definition := recipe(id)
	if definition.is_empty(): return false
	for kind: String in definition.inputs:
		if int(materials.get(kind, 0)) < int(definition.inputs[kind]): return false
	return true

static func craft(materials: Dictionary, id: String) -> Dictionary:
	if not can_craft(materials, id): return {}
	var result := materials.duplicate()
	var definition := recipe(id)
	for kind: String in definition.inputs: result[kind] = int(result.get(kind, 0)) - int(definition.inputs[kind])
	for kind: String in definition.outputs: result[kind] = int(result.get(kind, 0)) + int(definition.outputs[kind])
	return result
