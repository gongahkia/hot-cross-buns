class_name SurvivalMovementFeedback
extends RefCounted

static func present(movement: Dictionary) -> Dictionary:
	if not bool(movement.get("allowed", true)): return {"tier":"INCAPACITATED","text":"MVT INCAPACITATED","color":Color("#df7b6e")}
	var multiplier := clampf(float(movement.get("speed_multiplier", 1.0)), 0.0, 1.0)
	var pressure := clampf(float(movement.get("recovery_pressure", 0.0)), 0.0, 1.0)
	var tier := "OPTIMAL" if multiplier >= 0.985 else "STRAINED" if multiplier >= 0.88 else "FATIGUED" if multiplier >= 0.75 else "CRITICAL"
	var color: Color = {"OPTIMAL":Color("#9edbb8"),"STRAINED":Color("#f2d98c"),"FATIGUED":Color("#e6a564"),"CRITICAL":Color("#df7b6e")}[tier]
	return {"tier":tier,"text":"MVT %s %02d%% x%.2f" % [tier,roundi(pressure*100.0),multiplier],"color":color}
