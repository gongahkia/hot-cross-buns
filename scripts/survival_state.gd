class_name SurvivalState
extends Node

signal changed(snapshot: Dictionary)
signal depleted(reason: String)

const MAX_VALUE := 100.0

var hunger := MAX_VALUE
var thirst := MAX_VALUE
var warmth := MAX_VALUE
var health := MAX_VALUE
var fatigue := 0.0
var materials: Dictionary = {"wood": 0, "scrap": 0, "fiber": 0, "food": 0, "water": 0, "dirty_water": 0}
var alive := true
var run_seed := 0

func begin_run(seed: int) -> void:
	run_seed = seed
	hunger = MAX_VALUE
	thirst = MAX_VALUE
	warmth = MAX_VALUE
	health = MAX_VALUE
	fatigue = 0.0
	materials = {"wood": 0, "scrap": 0, "fiber": 0, "food": 0, "water": 0, "dirty_water": 0}
	alive = true
	changed.emit(snapshot())

func advance(delta: float, environment: Dictionary, movement_active: bool) -> void:
	if not alive: return
	var temperature := float(environment.get("temperature", 0.55))
	var rainfall := float(environment.get("rainfall", 0.45))
	var exposed := absf(temperature - 0.55) * 2.0 + rainfall * 0.3
	hunger = maxf(0.0, hunger - delta * (0.28 + fatigue * 0.004))
	thirst = maxf(0.0, thirst - delta * (0.42 + maxf(temperature - 0.55, 0.0) * 0.35))
	warmth = clampf(warmth + delta * (0.18 - exposed * 0.65), 0.0, MAX_VALUE)
	fatigue = clampf(fatigue + delta * (0.48 if movement_active else -0.24), 0.0, MAX_VALUE)
	if hunger <= 0.0 or thirst <= 0.0 or warmth <= 0.0:
		health = maxf(0.0, health - delta * 4.0)
	if health <= 0.0:
		alive = false
		depleted.emit("exposure" if warmth <= 0.0 else "deprivation")
	changed.emit(snapshot())

func collect(kind: String, amount := 1) -> void:
	if not materials.has(kind): return
	materials[kind] = int(materials[kind]) + amount
	changed.emit(snapshot())

func consume(kind: String) -> bool:
	if int(materials.get(kind, 0)) <= 0: return false
	materials[kind] = int(materials[kind]) - 1
	if kind == "food": hunger = minf(MAX_VALUE, hunger + 34.0)
	if kind == "water": thirst = minf(MAX_VALUE, thirst + 42.0)
	changed.emit(snapshot())
	return true

func consume_food() -> bool:
	return consume("food")

func consume_water() -> bool:
	return consume("water")

func collect_water_source(environment:Dictionary) -> String:
	var biome:=str(environment.get("biome",""));var family:=str(environment.get("region",{}).get("family",""));var source:=(bool(environment.get("water",false)) and biome not in ["ocean","coast"]) or biome in ["lake","river","wetland","lagoon","mangrove"]
	if not source:return ""
	var kind:="dirty_water" if family in ["flooded_city","industrial_ruin"] or biome in ["wetland","lagoon","mangrove"] else "water";collect(kind);return kind

func purify_water() -> bool:
	if int(materials.get("dirty_water",0))<=0:return false
	materials["dirty_water"]=int(materials["dirty_water"])-1;materials["water"]=int(materials["water"])+1;changed.emit(snapshot());return true

func apply_injury(amount: float) -> void:
	if not alive: return
	health = maxf(0.0, health - amount)
	if health <= 0.0:
		alive = false
		depleted.emit("injury")
	changed.emit(snapshot())

func snapshot() -> Dictionary:
	return {"hunger": hunger, "thirst": thirst, "warmth": warmth, "health": health, "fatigue": fatigue, "materials": materials.duplicate(), "alive": alive, "seed": run_seed}
