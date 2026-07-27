class_name StyleRun
extends RefCounted

const LINK_WINDOW := 1.15
const FINISH_BONUS := 1000
const MAX_MULTIPLIER := 10
const REPEAT_VALUES := [1.0, 0.65, 0.35, 0.15]
const BASE_POINTS := {
	"jump": 80,
	"double_jump": 120,
	"dash": 160,
	"sprint_dash": 180,
	"slide": 110,
	"grapple": 200,
	"launch": 180,
	"boost": 120,
	"wall_jump": 180,
	"slam_land": 220,
	"collectible": 90,
	"speed": 35,
	"airtime": 45,
	"glide": 55,
	"gap": 300
}

var banked_score := 0
var active_base := 0
var action_count := 0
var multiplier := 1
var longest_combo := 0
var last_action_time := -INF
var active := false
var repetitions: Dictionary = {}
var used_gaps: Dictionary = {}
var last_action := ""
var last_banked := 0
var last_lost := 0

func begin() -> void:
	banked_score = 0
	active_base = 0
	action_count = 0
	multiplier = 1
	longest_combo = 0
	last_action_time = -INF
	active = false
	repetitions.clear()
	used_gaps.clear()
	last_action = ""
	last_banked = 0
	last_lost = 0

func add_action(action: String, now: float, override_points := -1, gap_id := "") -> Dictionary:
	if action == "gap" and (gap_id.is_empty() or used_gaps.has(gap_id)):
		return snapshot()
	if active and now - last_action_time > LINK_WINDOW:
		bank()
	if not active:
		_start_combo(now)
	var repetition_key := action if gap_id.is_empty() else action + ":" + gap_id
	var repeat_count := int(repetitions.get(repetition_key, 0))
	var repeat_scale := float(REPEAT_VALUES[min(repeat_count, REPEAT_VALUES.size() - 1)])
	var base := int(BASE_POINTS.get(action, 50)) if override_points < 0 else override_points
	active_base += int(round(float(base) * repeat_scale))
	repetitions[repetition_key] = repeat_count + 1
	if action == "gap":
		used_gaps[gap_id] = true
	if not _is_flow_action(action):
		action_count += 1
		multiplier = mini(MAX_MULTIPLIER, action_count)
		longest_combo = maxi(longest_combo, action_count)
	last_action_time = now
	last_action = action
	return snapshot()

func land(now: float) -> Dictionary:
	if active:
		last_action_time = maxf(last_action_time, now)
	return snapshot()

func tick(now: float) -> Dictionary:
	if active and now - last_action_time > LINK_WINDOW:
		bank()
	return snapshot()

func bail() -> Dictionary:
	last_lost = active_score()
	_clear_active()
	return snapshot()

func finish(now: float) -> Dictionary:
	if active:
		bank()
	banked_score += FINISH_BONUS
	last_banked = FINISH_BONUS
	return snapshot()

func bank() -> Dictionary:
	if not active:
		return snapshot()
	last_banked = active_score()
	banked_score += last_banked
	_clear_active()
	return snapshot()

func active_score() -> int:
	return active_base * multiplier if active else 0

func total_score() -> int:
	return banked_score + active_score()

func tier() -> String:
	var score := total_score()
	if score >= 50000:
		return "LEGEND"
	if score >= 20000:
		return "WILD"
	if score >= 8000:
		return "CHARGED"
	if score >= 2000:
		return "FLOW"
	return "QUIET"

func meter_ratio() -> float:
	var score := total_score()
	if score < 2000:
		return float(score) / 2000.0
	if score < 8000:
		return float(score - 2000) / 6000.0
	if score < 20000:
		return float(score - 8000) / 12000.0
	if score < 50000:
		return float(score - 20000) / 30000.0
	return 1.0

func snapshot() -> Dictionary:
	return {
		"banked": banked_score,
		"active": active_score(),
		"actions": action_count,
		"multiplier": multiplier,
		"longest_combo": longest_combo,
		"last_action": last_action,
		"last_banked": last_banked,
		"last_lost": last_lost,
		"tier": tier(),
		"meter_ratio": meter_ratio()
	}

func _start_combo(now: float) -> void:
	active = true
	active_base = 0
	action_count = 0
	multiplier = 1
	last_action_time = now
	repetitions.clear()
	used_gaps.clear()
	last_action = ""
	last_banked = 0

func _clear_active() -> void:
	active = false
	active_base = 0
	action_count = 0
	multiplier = 1
	last_action_time = -INF
	repetitions.clear()
	used_gaps.clear()
	last_action = ""

func _is_flow_action(action: String) -> bool:
	return action in ["speed", "airtime", "glide"]
