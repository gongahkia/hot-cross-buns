class_name EndlessRunPacingSimulation
extends RefCounted

const SURVIVAL := preload("res://scripts/survival_state.gd")
const MOVEMENT_POLICY := preload("res://scripts/survival_movement_policy.gd")
const TELEMETRY := preload("res://scripts/survival_traversal_telemetry.gd")
const RNG := preload("res://scripts/world_rng.gd")
const CYCLE_SECONDS := 120.0
const TRAVEL_SECONDS := 40.0
const RESUPPLY_SECONDS := 90.0

static func simulate(seed: int, duration_seconds: float = 7200.0, step_seconds: float = 1.0) -> Dictionary:
	assert(duration_seconds > 0.0 and step_seconds > 0.0, "simulation duration and step must be positive")
	var survival := SURVIVAL.new()
	survival.begin_run(seed)
	var telemetry := TELEMETRY.new()
	var elapsed := 0.0
	var resupplies := {"food":0,"water":0}
	while elapsed < duration_seconds and survival.alive:
		var delta := minf(step_seconds, duration_seconds - elapsed)
		var traveling := fmod(elapsed, CYCLE_SECONDS) < TRAVEL_SECONDS
		var state := "sprint" if traveling else "walk"
		var movement: Dictionary = MOVEMENT_POLICY.evaluate(survival.snapshot(), state)
		telemetry.record(delta, survival.snapshot(), movement, {"movement_multiplier":1.35 if traveling else 1.0})
		if traveling and posmod(floori(elapsed), 20) == 0: telemetry.record_action("grapple")
		survival.advance(delta, _environment(seed, elapsed, traveling), traveling)
		var prior_elapsed := elapsed
		elapsed += delta
		if floori(prior_elapsed / RESUPPLY_SECONDS) != floori(elapsed / RESUPPLY_SECONDS):
			survival.collect("food")
			survival.collect("water")
			survival.consume_food()
			survival.consume_water()
			resupplies.food = int(resupplies.food) + 1
			resupplies.water = int(resupplies.water) + 1
	var result := {"seed":seed,"requested_seconds":duration_seconds,"simulated_seconds":elapsed,"alive":survival.alive,"survival":survival.snapshot(),"resupplies":resupplies,"telemetry":telemetry.summary()}
	survival.free()
	return result

static func _environment(seed: int, elapsed: float, traveling: bool) -> Dictionary:
	var weather_cycle := floori(elapsed / 480.0)
	var in_storm := fmod(elapsed, 480.0) >= 240.0 and RNG.unit(seed, weather_cycle, 0, 731) > 0.55
	var temperature := 0.48 + RNG.signed(seed, weather_cycle, 0, 733) * 0.08
	return {"temperature":temperature,"rainfall":0.75 if in_storm else 0.25,"shelter":0.0 if traveling else 0.85,"weather":{"is_precipitating":in_storm,"intensity":0.8 if in_storm else 0.0,"wind_speed":0.65 if in_storm else 0.15}}
