extends SceneTree

const PLACEMENT = preload("res://scripts/traversal_material_placement.gd")

var failed := false

func _initialize() -> void:
	var player := {"on_floor": true, "planar_speed": 1.0, "traversal_active": false}
	var surface := {"distance": 1.5, "slope": 0.1, "water": false}
	var inventory := {"wood": 1, "scrap": 0, "fiber": 1}
	var ready := PLACEMENT.evaluate(player, surface, inventory)
	_expect(bool(ready.allowed) and str(ready.reason) == "ready" and ready.cost == {"wood": 1, "fiber": 1}, "placement readiness drifted")
	_expect(str(PLACEMENT.evaluate({"on_floor": false}, surface, inventory).reason) == "grounded_required", "airborne placement gate drifted")
	_expect(str(PLACEMENT.evaluate({"on_floor": true, "planar_speed": 4.0}, surface, inventory).reason) == "stabilize_required", "movement placement gate drifted")
	_expect(str(PLACEMENT.evaluate(player, {"distance": 1.5, "slope": 0.5, "water": false}, inventory).reason) == "unsafe_surface", "surface placement gate drifted")
	_expect(str(PLACEMENT.evaluate(player, surface, {"wood": 1, "fiber": 0}).reason) == "materials_required" and ready == PLACEMENT.evaluate(player, surface, inventory), "placement material/determinism drifted")
	_expect(bool(PLACEMENT.evaluate(player, surface, {"wood": 2, "scrap": 2, "fiber": 1}, {"wood": 2, "scrap": 2, "fiber": 1}).allowed), "construction cost gate drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
