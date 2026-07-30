extends SceneTree

const LITHOLOGY = preload("res://scripts/world_lithology.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "oceanic", "age": 0.05}, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0), 1, 0.6, 0.05)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "oceanic", "age": 0.71}, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0), 6, 1.2, 0.71)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "oceanic", "age": 0.4, "boundary": 0.1}, 0.0, 0.0, 0.0, 0.0, -0.19, 0.0), 0, 1.0, 0.4)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "oceanic", "age": 0.4, "boundary": 0.1}, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.21), 1, 0.6, 0.4)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "oceanic", "age": 0.4, "boundary": 0.2}, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0), 5, 0.9, 0.4)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "continental", "age": 0.3}, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.6), 2, 0.5, 0.3)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "continental", "age": 0.3}, 0.0, 0.0, 0.4, 0.2, 0.0, 0.0), 4, 1.4, 0.3)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "continental", "age": 0.3, "boundary": 0.3}, 0.0, 0.0, 0.8, 0.17, 0.0, 0.0), 5, 0.9, 0.3)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "continental", "age": 0.3, "boundary": 0.6}, 0.0, 0.0, 0.8, 0.4, 0.0, 0.0), 3, 0.4, 0.3)
	_assert_result(LITHOLOGY.classify(20260730, {"crust": "continental", "age": 0.3, "boundary": 0.4}, 0.0, 0.0, 0.8, 0.56, 0.0, 0.0), 6, 1.2, 0.3)
	var props := LITHOLOGY.properties(1)
	props["name"] = "mutated"
	_expect(str(LITHOLOGY.properties(1).get("name", "")) == "basalt", "lithology properties leaked mutable data")
	var dry_cell := {"water": false, "rainfall": 0.11, "lithology_age": 0.4}
	_expect(LITHOLOGY.refine(dry_cell) == {"water": false, "rainfall": 0.11, "lithology_age": 0.4, "lithology": 7, "erodibility_k": 1.6}, "dry lithology refinement drifted")
	var protected_cell := {"water": false, "down_cell": {"x": 1}, "rainfall": 0.01, "lithology": 2}
	_expect(LITHOLOGY.refine(protected_cell) == protected_cell, "downstream lithology refinement drifted")
	quit(1 if failed else 0)

func _assert_result(result: Dictionary, id: int, erodibility_k: float, age: float) -> void:
	_expect(int(result.get("id", -1)) == id, "lithology classification drifted")
	_expect(absf(float(result.get("erodibility_k", 0.0)) - erodibility_k) <= EPSILON, "lithology erodibility drifted")
	_expect(absf(float(result.get("age", 0.0)) - age) <= EPSILON, "lithology age drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
