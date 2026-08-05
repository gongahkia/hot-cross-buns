extends Node

const STYLE_RUN := preload("res://scripts/style_run.gd")
const RULESET_VERSION := "1.0.0"

var active_level_id := ""
var run_seed := 0
var elapsed := 0.0
var collected := 0
var running := false
var style: StyleRun = STYLE_RUN.new()
var style_movement_active := false
var resources: Dictionary = {}
var discovered_regions: Array[String] = []
var outcome := "idle"

func begin_run(level_id: String, seed := 0) -> void:
	active_level_id = level_id
	run_seed = seed
	elapsed = 0.0
	collected = 0
	resources = {}
	discovered_regions = []
	style.begin()
	style_movement_active = false
	outcome = "active"
	running = true

func advance(delta: float) -> Dictionary:
	if not running:
		return style.snapshot()
	elapsed += delta
	style.update_movement_multiplier(delta, style_movement_active)
	return style.tick(elapsed)

func set_style_movement_active(active: bool) -> void:
	style_movement_active = active

func add_collectible() -> void:
	if running:
		collected += 1

func add_resource(kind: String, amount := 1) -> void:
	if not running: return
	resources[kind] = int(resources.get(kind, 0)) + amount

func discover_region(region_id: String) -> void:
	if running and not discovered_regions.has(region_id): discovered_regions.append(region_id)

func run_record(survival: Dictionary = {}) -> Dictionary:
	return {"level": active_level_id, "seed": run_seed, "elapsed": elapsed, "collectibles": collected, "resources": resources.duplicate(), "regions": discovered_regions.duplicate(), "style": style.snapshot(), "survival": survival, "outcome": outcome}

func finish(next_outcome: String, survival: Dictionary = {}) -> Dictionary:
	if not running: return run_record(survival)
	outcome = next_outcome
	running = false
	return run_record(survival)

func add_style_action(action: String, override_points := -1, gap_id := "") -> Dictionary:
	if not running:
		return style.snapshot()
	return style.add_action(action, elapsed, override_points, gap_id)

func style_land() -> Dictionary:
	if not running:
		return style.snapshot()
	return style.land(elapsed)

func bail_style() -> Dictionary:
	if not running:
		return style.snapshot()
	return style.bail()

func style_snapshot() -> Dictionary:
	return style.snapshot()
