extends SceneTree
const SIMULATION = preload("res://scripts/endless_run_pacing_simulation.gd")
var failed := false
func _initialize() -> void:
	var first: Dictionary = SIMULATION.simulate(20260730)
	var second: Dictionary = SIMULATION.simulate(20260730)
	var telemetry: Dictionary = first.telemetry
	_expect(first == second, "pacing soak is not deterministic")
	_expect(bool(first.alive) and is_equal_approx(float(first.simulated_seconds), 7200.0), "pacing soak did not complete two hours")
	_expect(int((first.resupplies as Dictionary).food) == 80 and int((telemetry.actions as Dictionary).grapple) > 0, "pacing resupply or traversal schedule drifted")
	_expect(float(telemetry.minimum_speed_multiplier) >= 0.65 and float(telemetry.maximum_recovery_pressure) <= 1.0, "pacing movement bounds drifted")
	_expect(SIMULATION.simulate(20260731) != first, "pacing soak ignored its seed")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
