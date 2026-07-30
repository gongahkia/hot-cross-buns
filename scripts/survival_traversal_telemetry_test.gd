extends SceneTree
const TELEMETRY = preload("res://scripts/survival_traversal_telemetry.gd")
var failed := false
func _initialize() -> void:
	var telemetry := TELEMETRY.new()
	telemetry.record(2.0, {"hunger":80.0,"thirst":70.0,"warmth":90.0,"health":100.0,"fatigue":10.0,"wetness":5.0,"exposure":0.2,"injury":0.0}, {"state":"sprint","speed_multiplier":0.90,"recovery_pressure":0.20}, {"movement_multiplier":1.2})
	telemetry.record(1.0, {"hunger":50.0,"thirst":40.0,"warmth":60.0,"health":80.0,"fatigue":40.0,"wetness":20.0,"exposure":0.7,"injury":12.0}, {"state":"grapple","speed_multiplier":0.70,"recovery_pressure":0.60}, {"movement_multiplier":1.5})
	telemetry.record_action("grapple")
	telemetry.record_action("grapple")
	telemetry.record_action("wall_jump")
	var summary: Dictionary = telemetry.summary()
	_expect(int(summary.samples) == 2 and is_equal_approx(float(summary.seconds), 3.0), "telemetry sample duration drifted")
	_expect(is_equal_approx(float((summary.average_survival as Dictionary).hunger), 70.0) and is_equal_approx(float((summary.movement_seconds as Dictionary).sprint), 2.0), "telemetry time weighting drifted")
	_expect(is_equal_approx(float(summary.minimum_speed_multiplier), 0.70) and is_equal_approx(float(summary.maximum_recovery_pressure), 0.60) and is_equal_approx(float(summary.average_style_movement_multiplier), 1.3), "telemetry balance extrema drifted")
	_expect(int((summary.actions as Dictionary).grapple) == 2 and int((summary.actions as Dictionary).wall_jump) == 1, "telemetry action counts drifted")
	var bounded := TELEMETRY.new()
	for index in range(35): bounded.record_action("action-%d" % index)
	var bounded_actions: Dictionary = bounded.summary().actions
	_expect(bounded_actions.size() == 33 and int(bounded_actions.other) == 3, "telemetry action capacity drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
