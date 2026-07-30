extends SceneTree

const LANDFORMS = preload("res://scripts/world_river_landforms.gd")

var failed := false

func _initialize() -> void:
	var mouth := {"gx": 1, "gy": 0, "water": true, "elevation_base": 0.0}
	var river := {"gx": 0, "gy": 0, "water": false, "flow": 100.0, "slope": 0.05, "elevation_base": 0.1, "sediment": 0.002, "down_cell": mouth}
	var bank := {"gx": 0, "gy": 1, "water": false, "flow": 0.0, "slope": 0.0, "elevation_base": 0.2, "sediment": 0.0}
	var fan_target := {"gx": 4, "gy": 0, "water": false, "flow": 0.0, "slope": 0.1, "elevation_base": 0.2, "sediment": 0.002}
	var fan := {"gx": 3, "gy": 0, "water": false, "flow": 100.0, "slope": 0.08, "elevation_base": 0.1, "sediment": 0.01, "plate_boundary": 0.5, "down_cell": fan_target}
	var region := {"cells": {"0:0": river, "1:0": mouth, "0:1": bank, "3:0": fan, "4:0": fan_target}}
	var stats := LANDFORMS.apply(region, {"river_threshold": 10.0})
	_expect(bool(river.river) and bool(river.delta) and bool(river.floodplain), "river/delta/floodplain classification drifted")
	_expect(bool(bank.river_bank), "river-bank classification drifted")
	_expect(bool(fan.alluvial_fan) and bool(fan.alluvial_fan_lobe) and bool(fan_target.alluvial_fan_lobe), "alluvial fan/lobe classification drifted")
	_expect(int(stats.rivers) == 2 and int(stats.deltas) == 1 and int(stats.alluvial_fans) == 1 and int(stats.fan_lobes) >= 2, "river landform statistics drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
