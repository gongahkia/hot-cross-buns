extends Node

const STYLE_RUN := preload("res://scripts/style_run.gd")

var active_level_id := ""
var elapsed := 0.0
var collected := 0
var running := false
var style: StyleRun = STYLE_RUN.new()
var style_movement_active := false

func begin_run(level_id: String) -> void:
	active_level_id = level_id
	elapsed = 0.0
	collected = 0
	style.begin()
	style_movement_active = false
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
