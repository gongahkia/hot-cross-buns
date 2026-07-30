class_name SurvivalMovementPolicy
extends RefCounted

const STATES=["walk","sprint","slide","dash","glide","grapple"]
const MIN_SPEED_MULTIPLIER:=.65

static func evaluate(snapshot:Dictionary,state:String)->Dictionary:
	assert(STATES.has(state),"unknown movement state")
	var hunger:=clampf(float(snapshot.get("hunger",100.0)),0.0,100.0);var thirst:=clampf(float(snapshot.get("thirst",100.0)),0.0,100.0);var warmth:=clampf(float(snapshot.get("warmth",100.0)),0.0,100.0);var health:=clampf(float(snapshot.get("health",100.0)),0.0,100.0);var fatigue:=clampf(float(snapshot.get("fatigue",0.0)),0.0,100.0);var strain:=(100.0-hunger)*.0015+(100.0-thirst)*.002+(100.0-warmth)*.001+(100.0-health)*.0015+fatigue*.002
	var state_weight:=1.15 if state=="sprint" else 1.05 if state in ["slide","dash"] else 1.0;return {"state":state,"allowed":bool(snapshot.get("alive",true)),"speed_multiplier":clampf(1.0-strain*state_weight,MIN_SPEED_MULTIPLIER,1.0),"recovery_pressure":clampf(strain,0.0,1.0)}
