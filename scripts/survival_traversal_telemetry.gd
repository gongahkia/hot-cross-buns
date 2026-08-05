class_name SurvivalTraversalTelemetry
extends RefCounted

const SURVIVAL_KEYS := ["hunger", "thirst", "warmth", "health", "fatigue", "wetness", "exposure", "injury"]
const MOVEMENT_STATES := ["walk", "sprint", "slide", "dash", "glide", "grapple"]
const MAX_ACTION_TYPES := 32

var samples := 0
var seconds := 0.0
var survival_totals: Dictionary = {}
var movement_seconds: Dictionary = {}
var action_counts: Dictionary = {}
var minimum_speed_multiplier := 1.0
var maximum_recovery_pressure := 0.0
var style_multiplier_total := 0.0

func _init() -> void:
	for key: String in SURVIVAL_KEYS: survival_totals[key] = 0.0

func record(delta: float, survival: Dictionary, movement: Dictionary, style: Dictionary = {}) -> void:
	if delta <= 0.0: return
	samples += 1
	seconds += delta
	for key: String in SURVIVAL_KEYS: survival_totals[key] = float(survival_totals[key]) + clampf(float(survival.get(key, 0.0)), 0.0, 100.0) * delta
	var state := str(movement.get("state", "walk"))
	if not MOVEMENT_STATES.has(state): state = "other"
	movement_seconds[state] = float(movement_seconds.get(state, 0.0)) + delta
	minimum_speed_multiplier = minf(minimum_speed_multiplier, clampf(float(movement.get("speed_multiplier", 1.0)), 0.0, 1.0))
	maximum_recovery_pressure = maxf(maximum_recovery_pressure, clampf(float(movement.get("recovery_pressure", 0.0)), 0.0, 1.0))
	style_multiplier_total += clampf(float(style.get("movement_multiplier", 1.0)), 1.0, 1.5) * delta

func record_action(action: String) -> void:
	var key := action.strip_edges().to_lower()
	if key.is_empty(): return
	if not action_counts.has(key) and action_counts.size() >= MAX_ACTION_TYPES: key = "other"
	action_counts[key] = int(action_counts.get(key, 0)) + 1

func summary() -> Dictionary:
	var averages: Dictionary = {}
	for key: String in SURVIVAL_KEYS: averages[key] = float(survival_totals[key]) / seconds if seconds > 0.0 else 0.0
	return {"samples":samples,"seconds":seconds,"average_survival":averages,"minimum_speed_multiplier":minimum_speed_multiplier,"maximum_recovery_pressure":maximum_recovery_pressure,"movement_seconds":movement_seconds.duplicate(),"actions":action_counts.duplicate(),"average_style_movement_multiplier":style_multiplier_total / seconds if seconds > 0.0 else 1.0}
