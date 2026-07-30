class_name WorldSoilClassification
extends RefCounted

const IDS := {"none": 0, "entisol": 1, "inceptisol": 2, "mollisol": 3, "vertisol": 4, "aridisol": 5, "histosol": 6, "spodosol": 7, "oxisol": 8, "andisol": 9, "ultisol": 10}
const NAMES := {0: "none", 1: "entisol", 2: "inceptisol", 3: "mollisol", 4: "vertisol", 5: "aridisol", 6: "histosol", 7: "spodosol", 8: "oxisol", 9: "andisol", 10: "ultisol"}
const TARGET_DISTRIBUTION := {1: 0.237, 2: 0.144, 3: 0.100, 4: 0.035, 5: 0.185, 6: 0.017, 7: 0.038, 8: 0.110, 9: 0.010, 10: 0.124}

static func ids() -> Dictionary:
	return IDS.duplicate(true)

static func names() -> Dictionary:
	return NAMES.duplicate(true)

static func target_distribution() -> Dictionary:
	return TARGET_DISTRIBUTION.duplicate(true)

static func classify(cell: Dictionary = {}) -> int:
	if bool(cell.get("water", false)):
		return int(IDS.none)
	var temperature := float(cell.get("temperature", 0.5))
	var rainfall := float(cell.get("rainfall", cell.get("precipitation", cell.get("moisture", 0.0))))
	var slope := float(cell.get("slope", 0.0))
	var regolith := float(cell.get("regolith_depth", 0.0))
	var soil_age := maxf(float(cell.get("plate_age", 0.0)), float(cell.get("lithology_age", 0.0)))
	var lithology := int(cell.get("lithology", 0))
	var biome := str(cell.get("biome", ""))
	var wet := biome == "wetland" or (float(cell.get("flow", 0.0)) > 180.0 and slope < 0.04 and rainfall > 0.45)
	if wet and temperature < 0.62:
		return int(IDS.histosol)
	if bool(cell.get("is_flood_basalt", false)) or float(cell.get("volcanic_form", 0.0)) > 0.0 or (float(cell.get("hotspot_contribution", 0.0)) > 0.12 and lithology == 1):
		return int(IDS.andisol)
	if rainfall < 0.16 or biome == "desert":
		return int(IDS.aridisol)
	if regolith < 0.045 or slope > 0.34 or soil_age < 0.08:
		return int(IDS.entisol)
	if lithology == 6 and rainfall > 0.22 and rainfall < 0.58 and slope < 0.08:
		return int(IDS.vertisol)
	if temperature > 0.68 and rainfall > 0.62 and soil_age > 0.45:
		return int(IDS.oxisol)
	if temperature > 0.48 and rainfall > 0.56 and soil_age > 0.28:
		return int(IDS.ultisol)
	if temperature < 0.38 and rainfall > 0.34 and (biome == "boreal_forest" or biome == "tundra" or lithology == 3):
		return int(IDS.spodosol)
	if (biome == "grassland" or biome == "savanna") and rainfall > 0.22 and rainfall < 0.62 and slope < 0.16:
		return int(IDS.mollisol)
	if regolith > 0.08 and soil_age > 0.12:
		return int(IDS.inceptisol)
	return int(IDS.entisol)

static func apply_region(region: Dictionary) -> Dictionary:
	var counts := {}
	var cells := 0
	for cell: Dictionary in _cells(region):
		var id := classify(cell)
		cell["soil_order"] = id
		if id > 0:
			cells += 1
			counts[id] = int(counts.get(id, 0)) + 1
	var stats := {"cells": cells, "counts": counts}
	region["soils"] = stats
	return stats

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []
