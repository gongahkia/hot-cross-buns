extends SceneTree

const OROMETRY = preload("res://scripts/world_orometry.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var profiles := OROMETRY.profiles()
	_expect(profiles.size() == 6, "orometry profile count drifted")
	_expect(profiles.map(func(profile): return profile.get("key", "")) == ["alps", "appalachians", "himalaya", "andes", "fjordland", "basinrange"], "orometry profile order drifted")
	for profile in profiles:
		_expect((profile.get("peak_prominence_hist", []) as Array).size() == 16 and (profile.get("saddle_prominence_hist", []) as Array).size() == 16, "orometry prominence histogram drifted")
	profiles[0]["name"] = "mutated"
	_expect(str(OROMETRY.profiles()[0].get("name", "")) == "Alps", "orometry profiles leaked mutable data")
	_assert_pick(OROMETRY.pick(20260730, 128.0, -384.0), 3, 1.0, 2.2, 1.12, 0.12, 2.0)
	_assert_pick(OROMETRY.pick(20260730, 0.0, 0.0), 2, 1.0, 0.52, 0.70, -0.045, 0.52)
	_assert_pick(OROMETRY.pick(20260730, 1023.0, 128.0), 5, 0.0, 1.30, 1.16, 0.055, 1.28)
	_expect(OROMETRY.pick(20260730, -1.0, -1.0) == OROMETRY.pick(20260730, -1.0, -1.0), "orometry negative coordinate selection is not repeatable")
	quit(1 if failed else 0)

func _assert_pick(actual: Dictionary, id: int, blend: float, peak_amp: float, ridge_frequency: float, slope_bias: float, relief: float) -> void:
	var modifiers: Dictionary = actual.get("modifiers", {})
	_expect(int(actual.get("id", 0)) == id, "orometry archetype selection drifted")
	_expect(absf(float(actual.get("blend", 0.0)) - blend) <= EPSILON, "orometry edge blend drifted")
	_expect(absf(float(modifiers.get("peak_amp_scale", 0.0)) - peak_amp) <= EPSILON, "orometry peak scale drifted")
	_expect(absf(float(modifiers.get("ridge_freq_scale", 0.0)) - ridge_frequency) <= EPSILON, "orometry ridge frequency drifted")
	_expect(absf(float(modifiers.get("slope_bias", 0.0)) - slope_bias) <= EPSILON, "orometry slope bias drifted")
	_expect(absf(float(modifiers.get("relief_scale", 0.0)) - relief) <= EPSILON, "orometry relief scale drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
