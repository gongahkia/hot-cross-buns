extends SceneTree

const PLATES = preload("res://scripts/world_plates.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var plates = PLATES.new(20260730)
	_assert_center(plates.center(0, -1), 1026967433, -0.10808972967778, 0.47490956734389, "oceanic", 0.46408146736212)
	_assert_classification(plates.plate_at(128.0, -384.0), 1026967433, 1046447427, "oceanic", "oceanic", 0.79503074444378, 0.0033751747313911, 0.0, 0.0026833676793257, true)
	_assert_classification(plates.plate_at(-6400.0, -6400.0), -463262679, -133512161, "continental", "continental", 0.74962690612995, 0.0, 0.057321534318094, 0.0, false)
	_assert_classification(plates.plate_at(-4480.0, -6400.0), -692700201, -347010467, "oceanic", "continental", 0.45918054739534, 0.064290684228513, 0.0, 0.029521031576469, true)
	_expect(plates.plate_at(128.0, -384.0) == plates.plate_at(128.0, -384.0), "plate classification is not repeatable")
	var nearest: Dictionary = plates.nearest(-1.0, -641.0)
	var nearest_first: Dictionary = nearest.get("first", {})
	_expect(int(nearest_first.get("id", 0)) == 1046447427 and int(nearest_first.get("cell_x", 0)) == 0 and int(nearest_first.get("cell_z", 0)) == -2, "negative-coordinate nearest lookup drifted")
	quit(1 if failed else 0)

func _assert_center(center: Dictionary, expected_id: int, vx: float, vz: float, crust: String, age: float) -> void:
	_expect(int(center.get("id", 0)) == expected_id, "plate center id drifted")
	_expect(absf(float(center.get("vx", 0.0)) - vx) <= EPSILON, "plate velocity x drifted")
	_expect(absf(float(center.get("vz", 0.0)) - vz) <= EPSILON, "plate velocity z drifted")
	_expect(str(center.get("crust", "")) == crust, "plate crust drifted")
	_expect(absf(float(center.get("age", 0.0)) - age) <= EPSILON, "plate age drifted")

func _assert_classification(actual: Dictionary, id: int, secondary_id: int, crust: String, secondary_crust: String, boundary: float, convergent: float, divergent: float, oceanic_subduction: float, subducting: bool) -> void:
	_expect(int(actual.get("id", 0)) == id and int(actual.get("secondary_id", 0)) == secondary_id, "plate nearest IDs drifted")
	_expect(str(actual.get("crust", "")) == crust and str(actual.get("secondary_crust", "")) == secondary_crust, "plate crust classification drifted")
	_expect(absf(float(actual.get("boundary", 0.0)) - boundary) <= EPSILON, "plate boundary drifted")
	_expect(absf(float(actual.get("convergent", 0.0)) - convergent) <= EPSILON, "plate convergence drifted")
	_expect(absf(float(actual.get("divergent", 0.0)) - divergent) <= EPSILON, "plate divergence drifted")
	_expect(absf(float(actual.get("oceanic_subduction", 0.0)) - oceanic_subduction) <= EPSILON, "plate subduction drifted")
	_expect(bool(actual.get("subducting", false)) == subducting, "plate subducting side drifted")
	_expect(float(actual.get("boundary", 0.0)) >= 0.0 and float(actual.get("boundary", 0.0)) <= 1.0, "plate boundary escaped normalized range")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
