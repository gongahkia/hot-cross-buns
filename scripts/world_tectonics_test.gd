extends SceneTree

const CONTINENTS = preload("res://scripts/world_continents.gd")
const TECTONICS = preload("res://scripts/world_tectonics.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var continents = CONTINENTS.new(20260730)
	var tectonics = TECTONICS.new(20260730)
	_assert_result(tectonics.synthesize(continents.sample(-8320.0, -8960.0)), 0.46333750275228, 0.05318240717493, 0.0216613866484, 0.01554488865436, 0.0, 0.0, 0.0)
	_assert_result(tectonics.synthesize(continents.sample(-5120.0, -8960.0)), -0.10906842602047, 0.1707096132165, 0.0, 0.0, 0.0, 0.00414223393949, 0.0)
	var margin := tectonics.synthesize(continents.sample(-4480.0, -6400.0, "region"))
	_assert_result(margin, -0.36624835065847, 0.11853942293785, 0.0, 0.0, 0.0114172450019, 0.0, 0.35)
	var hot := tectonics.synthesize(continents.sample(-4480.0, -6400.0, "region"), {"contribution": 0.1})
	_expect(absf(float(hot.get("elevation", 0.0)) - float(margin.get("elevation", 0.0)) - 0.1) <= EPSILON, "optional hotspot contribution drifted")
	_expect(tectonics.synthesize(continents.sample(-5120.0, -8960.0)) == tectonics.synthesize(continents.sample(-5120.0, -8960.0)), "tectonic synthesis is not repeatable")
	quit(1 if failed else 0)

func _assert_result(result: Dictionary, elevation: float, uplift: float, continental_rift: float, rift_valley: float, trench: float, island_arc: float, passive_margin: float) -> void:
	_expect(absf(float(result.get("elevation", 0.0)) - elevation) <= EPSILON, "tectonic elevation drifted")
	_expect(absf(float(result.get("uplift", 0.0)) - uplift) <= EPSILON, "tectonic uplift drifted")
	_expect(absf(float(result.get("continental_rift", 0.0)) - continental_rift) <= EPSILON, "tectonic rift drifted")
	_expect(absf(float(result.get("rift_valley", 0.0)) - rift_valley) <= EPSILON, "tectonic rift-valley drifted")
	_expect(absf(float(result.get("trench", 0.0)) - trench) <= EPSILON, "tectonic trench drifted")
	_expect(absf(float(result.get("island_arc", 0.0)) - island_arc) <= EPSILON, "tectonic island-arc drifted")
	_expect(absf(float(result.get("passive_margin", 0.0)) - passive_margin) <= EPSILON, "tectonic passive-margin drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
