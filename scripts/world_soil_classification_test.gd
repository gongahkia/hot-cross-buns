extends SceneTree

const SOILS = preload("res://scripts/world_soil_classification.gd")

var failed := false

func _initialize() -> void:
	var ids := SOILS.ids()
	var fixtures := {
		int(ids.entisol): {"temperature": 0.5, "rainfall": 0.4, "slope": 0.38, "regolith_depth": 0.02, "lithology": 5, "plate_age": 0.4, "biome": "grassland"},
		int(ids.inceptisol): {"temperature": 0.48, "rainfall": 0.42, "slope": 0.09, "regolith_depth": 0.14, "lithology": 5, "plate_age": 0.2, "biome": "temperate_forest"},
		int(ids.mollisol): {"temperature": 0.56, "rainfall": 0.34, "slope": 0.05, "regolith_depth": 0.22, "lithology": 5, "plate_age": 0.5, "biome": "grassland"},
		int(ids.vertisol): {"temperature": 0.58, "rainfall": 0.38, "slope": 0.03, "regolith_depth": 0.24, "lithology": 6, "plate_age": 0.5, "biome": "savanna"},
		int(ids.aridisol): {"temperature": 0.72, "rainfall": 0.08, "slope": 0.04, "regolith_depth": 0.16, "lithology": 5, "plate_age": 0.4, "biome": "desert"},
		int(ids.histosol): {"temperature": 0.32, "rainfall": 0.72, "slope": 0.01, "regolith_depth": 0.18, "lithology": 6, "plate_age": 0.4, "biome": "wetland", "flow": 260.0},
		int(ids.spodosol): {"temperature": 0.24, "rainfall": 0.56, "slope": 0.06, "regolith_depth": 0.18, "lithology": 3, "plate_age": 0.5, "biome": "boreal_forest"},
		int(ids.oxisol): {"temperature": 0.76, "rainfall": 0.82, "slope": 0.05, "regolith_depth": 0.26, "lithology": 4, "plate_age": 0.75, "biome": "rainforest"},
		int(ids.andisol): {"temperature": 0.52, "rainfall": 0.5, "slope": 0.12, "regolith_depth": 0.16, "lithology": 1, "plate_age": 0.2, "biome": "rock", "is_flood_basalt": true},
		int(ids.ultisol): {"temperature": 0.62, "rainfall": 0.66, "slope": 0.07, "regolith_depth": 0.2, "lithology": 5, "plate_age": 0.45, "biome": "temperate_forest"},
	}
	for id: int in fixtures:
		_expect(SOILS.classify(fixtures[id]) == id, "soil order classification drifted for %d" % id)
	_expect(SOILS.classify({"water": true}) == int(ids.none), "water soil classification drifted")
	var region := {"cells": []}
	for id: int in fixtures:
		region.cells.append(fixtures[id].duplicate())
	var stats := SOILS.apply_region(region)
	_expect(int(stats.cells) == fixtures.size(), "land soil count drifted")
	for id: int in fixtures:
		_expect(int(stats.counts.get(id, 0)) == 1, "soil order region count drifted")
	for cell: Dictionary in region.cells:
		_expect(int(cell.get("soil_order", 0)) > 0, "soil order was not written to a land cell")
	var names := SOILS.names()
	names[1] = "mutated"
	_expect(str(SOILS.names().get(1, "")) == "entisol", "soil names leaked mutable data")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
