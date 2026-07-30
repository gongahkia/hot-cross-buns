extends SceneTree

const STREAM_POWER = preload("res://scripts/world_stream_power.gd")

var failed := false

func _initialize() -> void:
	var low := {"gx": 0, "gy": 0, "elevation_base": 0.0, "elevation": 0.0, "flow": 1.0, "water": false}
	var high := {"gx": 1, "gy": 0, "elevation_base": 1.0, "elevation": 1.0, "flow": 100.0, "water": false, "down_cell": low, "down_distance": 1.0, "erodibility_k": 1.6}
	var result := STREAM_POWER.relax({"visit_order": [low, high], "sea_level": -1.0, "stride": 1.0}, {"iterations": 1, "k": 0.01, "m": 0.5, "n": 1.0, "uplift": false})
	_expect(float(high.stream_power_erosion) > 0.0 and float(high.elevation) < 1.0 and float(high.bedrock_elevation) + float(high.regolith_depth) == float(high.elevation), "stream-power incision/regolith sync drifted")
	_expect(float(result.max_erosion) == float(high.stream_power_erosion) and float(high.sediment_flux) > 0.0, "stream-power statistics/sediment routing drifted")
	var softer_low := {"elevation_base": 0.0, "elevation": 0.0, "flow": 1.0, "water": false}
	var softer_high := {"elevation_base": 1.0, "elevation": 1.0, "flow": 100.0, "water": false, "down_cell": softer_low, "down_distance": 1.0, "erodibility_k": 0.4}
	STREAM_POWER.relax({"visit_order": [softer_low, softer_high], "sea_level": -1.0}, {"iterations": 1, "k": 0.01, "uplift": false})
	_expect(float(high.stream_power_erosion) > float(softer_high.stream_power_erosion), "lithology erodibility no longer scales stream power")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
