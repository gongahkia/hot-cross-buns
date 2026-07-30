extends SceneTree
const FEEDBACK = preload("res://scripts/survival_movement_feedback.gd")
var failed := false
func _initialize() -> void:
	_expect(FEEDBACK.present({"allowed":true,"speed_multiplier":1.0,"recovery_pressure":0.0}).tier == "OPTIMAL", "healthy movement feedback drifted")
	var fatigued: Dictionary = FEEDBACK.present({"allowed":true,"speed_multiplier":0.80,"recovery_pressure":0.23})
	_expect(fatigued.tier == "FATIGUED" and fatigued.text == "MVT FATIGUED 23% x0.80", "fatigue feedback drifted")
	_expect(FEEDBACK.present({"allowed":true,"speed_multiplier":0.65,"recovery_pressure":1.0}).tier == "CRITICAL", "critical movement feedback drifted")
	_expect(FEEDBACK.present({"allowed":false}).text == "MVT INCAPACITATED", "incapacitated movement feedback drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
