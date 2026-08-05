extends SceneTree

const FLOW = preload("res://scripts/world_flow_accumulation.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var root := {"flow": 1.0}
	var left := {"flow": 2.0, "down_cell": root}
	var right := {"flow": 3.0, "down_cell": root}
	var headwater := {"flow": 4.0, "down_cell": left}
	var result := FLOW.accumulate([root, left, right, headwater])
	_expect(int(result.cells) == 4 and int(result.edges) == 3, "flow accumulation topology count drifted")
	_expect(absf(float(left.flow) - 5.94) <= EPSILON, "flow accumulation upstream transfer drifted")
	_expect(absf(float(root.flow) - 9.8059) <= EPSILON, "flow accumulation downstream total drifted")
	_expect(absf(float(result.transferred) - 12.7459) <= EPSILON and absf(float(result.max_flow) - 9.8059) <= EPSILON, "flow accumulation statistics drifted")
	var rain_region := {"cells": [{"rainfall": 0.0}, {"precipitation": 0.2}]}
	_expect(FLOW.seed_from_rainfall(rain_region, 2.0) == {"cells": 2, "seeded_flow": 0.8400000000000001}, "flow rainfall seeding stats drifted")
	_expect(absf(float(rain_region.cells[0].flow) - 0.04) <= EPSILON and absf(float(rain_region.cells[1].flow) - 0.8) <= EPSILON, "flow rainfall seeding values drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
