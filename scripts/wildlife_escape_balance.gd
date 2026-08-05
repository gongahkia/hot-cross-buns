class_name WildlifeEscapeBalance
extends RefCounted

const POLICY := preload("res://scripts/wildlife_encounter_policy.gd")

static func rate(archetype: Dictionary, samples: int = 32) -> Dictionary:
	var escaping := 0
	for index in range(maxi(samples, 1)):
		var distance := float(index)*float(archetype.get("awareness_range", 0.0))/float(maxi(samples-1, 1))
		var decision: Dictionary = POLICY.decide(archetype, {"player_distance":distance,"territory_intrusion":bool(archetype.get("territorial", false)),"warning_issued":true})
		if str(decision.state) == "flee": escaping += 1
	return {"samples":maxi(samples,1),"escaping":escaping,"rate":float(escaping)/float(maxi(samples,1))}
