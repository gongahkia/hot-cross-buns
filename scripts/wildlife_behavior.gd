class_name WildlifeBehavior
extends RefCounted

const POLICY := preload("res://scripts/wildlife_encounter_policy.gd")

static func step(archetype: Dictionary, animal_position: Vector3, player_position: Vector3, warning_issued: bool = false) -> Dictionary:
	var offset := animal_position - player_position
	var distance := offset.length()
	var territory_intrusion := bool(archetype.get("territorial", false)) and distance <= float(archetype.get("awareness_range", 0.0)) * 0.6
	var decision: Dictionary = POLICY.decide(archetype, {"player_distance":distance,"has_line_of_sight":true,"territory_intrusion":territory_intrusion,"warning_issued":warning_issued})
	var direction := offset.normalized() if offset.length() > 0.001 else Vector3.FORWARD
	return {"state":str(decision.state),"direction":direction,"speed":7.0 if str(decision.state) == "flee" else 0.0,"warning_issued":warning_issued or str(decision.state) == "warn"}
