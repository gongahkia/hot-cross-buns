class_name StyleRun
extends RefCounted

const LINK_WINDOW := 1.15
const FINISH_BONUS := 1000
const MAX_MULTIPLIER := 10
const MOVEMENT_MULTIPLIER_MAX := 1.5
const MOVEMENT_CHARGE_TIME := 0.75
const MOVEMENT_DECAY_TIME := 0.25
const STYLE_DECAY_DELAY := 1.8
const STYLE_DECAY_RATE := 80.0
const STYLE_DECAY_ACCELERATION := 35.0
const REPEAT_VALUES := [1.0, 0.65, 0.35, 0.15]
const BASE_POINTS := {
	"jump": 80,
	"double_jump": 120,
	"dash": 160,
	"air_dash": 160,
	"sprint_dash": 180,
	"slide": 110,
	"grapple": 200,
	"tether_release": 160,
	"launch": 180,
	"boost": 120,
	"wall_jump": 180,
	"wall_run": 150,
	"slide_jump": 190,
	"ramp_launch": 145,
	"perfect_land": 180,
	"slam_bounce": 210,
	"grind": 160,
	"recharge": 125,
	"glide_dive": 70,
	"slam_land": 220,
	"collectible": 90,
	"speed": 35,
	"airtime": 45,
	"glide": 55,
	"gap": 300
}
const TRANSITION_BONUSES := {
	"slide>slide_jump": {"label": "SLIDE HOP", "points": 140},
	"slide_jump>wall_run": {"label": "WALL FLOW", "points": 170},
	"air_dash>wall_run": {"label": "DASH CATCH", "points": 170},
	"wall_run>wall_jump": {"label": "WALL KICK LINK", "points": 150},
	"wall_run>grapple": {"label": "WALL TO TETHER", "points": 220},
	"wall_jump>grapple": {"label": "KICK TO TETHER", "points": 220},
	"grapple>tether_release": {"label": "SLINGSHOT", "points": 220},
	"tether_release>glide": {"label": "SWOOP EXIT", "points": 150},
	"glide>grind": {"label": "RAIL CATCH", "points": 180},
	"grind>air_dash": {"label": "RAIL EXIT", "points": 190},
	"slam_land>slam_bounce": {"label": "IMPACT REBOUND", "points": 180},
	"perfect_land>slide_jump": {"label": "PERFECT FLOW", "points": 220},
	"ramp_launch>grapple": {"label": "RAMP TO TETHER", "points": 190},
	"boost>grind": {"label": "BOOST RAIL", "points": 170},
}

var banked_score := 0
var active_base := 0
var action_count := 0
var multiplier := 1
var movement_multiplier := 1.0
var longest_combo := 0
var last_action_time := -INF
var active := false
var repetitions: Dictionary = {}
var used_gaps: Dictionary = {}
var last_action := ""
var last_award: Dictionary = {}
var last_banked := 0
var last_lost := 0
var last_style_action_time := -INF
var last_decay_sample_time := -INF
var pending_decay := 0.0
var last_decay := 0

func begin() -> void:
	banked_score = 0
	active_base = 0
	action_count = 0
	multiplier = 1
	movement_multiplier = 1.0
	longest_combo = 0
	last_action_time = -INF
	active = false
	repetitions.clear()
	used_gaps.clear()
	last_action = ""
	last_award.clear()
	last_banked = 0
	last_lost = 0
	last_style_action_time = -INF
	last_decay_sample_time = -INF
	pending_decay = 0.0
	last_decay = 0

func update_movement_multiplier(delta: float, movement_active: bool) -> Dictionary:
	var charge_rate := (MOVEMENT_MULTIPLIER_MAX - 1.0) / MOVEMENT_CHARGE_TIME
	var decay_rate := (MOVEMENT_MULTIPLIER_MAX - 1.0) / MOVEMENT_DECAY_TIME
	if movement_active:
		movement_multiplier = minf(MOVEMENT_MULTIPLIER_MAX, movement_multiplier + charge_rate * delta)
	else:
		movement_multiplier = maxf(1.0, movement_multiplier - decay_rate * delta)
	return snapshot()

func add_action(action: String, now: float, override_points := -1, gap_id := "") -> Dictionary:
	if action == "gap" and (gap_id.is_empty() or used_gaps.has(gap_id)):
		return _event_result({}, 0, 0)
	var banked_now := 0
	if active and now - last_action_time > LINK_WINDOW:
		banked_now = _bank_active()
	var was_active := active
	if not active:
		_start_combo(now)
	var active_before := active_score()
	var transition := _transition_for(last_action, action)
	var repetition_key := action if gap_id.is_empty() else action + ":" + gap_id
	var repeat_count := int(repetitions.get(repetition_key, 0))
	var repeat_scale := float(REPEAT_VALUES[min(repeat_count, REPEAT_VALUES.size() - 1)])
	var base := int(BASE_POINTS.get(action, 50)) if override_points < 0 else override_points
	var movement_points := int(round(float(base) * movement_multiplier))
	var awarded_base := int(round(float(movement_points) * repeat_scale))
	active_base += awarded_base
	var transition_points := int(transition.get("points", 0))
	active_base += transition_points
	repetitions[repetition_key] = repeat_count + 1
	if action == "gap":
		used_gaps[gap_id] = true
	if not _is_flow_action(action):
		action_count += 1
		multiplier = mini(MAX_MULTIPLIER, action_count)
		longest_combo = maxi(longest_combo, action_count)
	last_action_time = now
	last_style_action_time = now
	last_decay_sample_time = now
	pending_decay = 0.0
	last_decay = 0
	last_action = action
	var active_after := active_score()
	var total_points := active_after - active_before
	last_award = {
		"action": action,
		"label": _label_for(action, was_active),
		"base_points": base,
		"freshness": repeat_scale,
		"movement_multiplier": movement_multiplier,
		"combo_multiplier": multiplier,
		"transition": str(transition.get("label", "")),
		"transition_points": transition_points * multiplier,
		"points": total_points,
		"severity": _severity_for(action, total_points),
		"rank_up": tier() != _tier_for_score(banked_score + active_before),
		"tier": tier()
	}
	return _event_result(last_award, banked_now, 0)

func land(now: float) -> Dictionary:
	if active:
		last_action_time = maxf(last_action_time, now)
	return _event_result({}, 0, 0)

func tick(now: float) -> Dictionary:
	var banked_now := 0
	if active and now - last_action_time > LINK_WINDOW:
		banked_now = _bank_active()
	if banked_now == 0:
		last_banked = 0
	_decay_banked_style(now)
	return _event_result({}, banked_now, 0)

func bail() -> Dictionary:
	var lost_now := active_score()
	last_lost = lost_now
	last_banked = 0
	_clear_active()
	return _event_result({}, 0, lost_now)

func finish(_now: float) -> Dictionary:
	if active:
		_bank_active()
	banked_score += FINISH_BONUS
	last_banked = FINISH_BONUS
	return snapshot()

func bank() -> Dictionary:
	_bank_active()
	return snapshot()

func active_score() -> int:
	return active_base * multiplier if active else 0

func total_score() -> int:
	return banked_score + active_score()

func tier() -> String:
	return _tier_for_score(total_score())

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
		"movement_multiplier": movement_multiplier,
		"longest_combo": longest_combo,
		"last_action": last_action,
		"last_award": last_award.duplicate(true),
		"last_banked": last_banked,
		"last_lost": last_lost,
		"last_decay": last_decay,
		"tier": tier(),
		"meter_ratio": meter_ratio()
	}

func _event_result(award: Dictionary, banked_now: int, lost_now: int) -> Dictionary:
	var result := snapshot()
	result["awarded"] = not award.is_empty()
	result["award"] = award.duplicate(true)
	result["banked_now"] = banked_now
	result["lost_now"] = lost_now
	return result

func _bank_active() -> int:
	if not active:
		return 0
	var gained := active_score()
	last_banked = gained
	last_lost = 0
	banked_score += gained
	_clear_active()
	return gained

func _start_combo(now: float) -> void:
	active = true
	active_base = 0
	action_count = 0
	multiplier = 1
	last_action_time = now
	repetitions.clear()
	used_gaps.clear()
	last_action = ""
	last_award.clear()
	last_banked = 0
	last_decay = 0

func _clear_active() -> void:
	active = false
	active_base = 0
	action_count = 0
	multiplier = 1
	last_action_time = -INF
	repetitions.clear()
	used_gaps.clear()
	last_action = ""
	last_award.clear()

func _decay_banked_style(now: float) -> void:
	last_decay = 0
	if active or banked_score <= 0 or last_style_action_time == -INF:
		last_decay_sample_time = now
		return
	var decay_start_time := last_style_action_time + STYLE_DECAY_DELAY
	if now <= decay_start_time:
		last_decay_sample_time = now
		return
	var sample_start := maxf(last_decay_sample_time, decay_start_time)
	if sample_start >= now:
		return
	var start_elapsed := sample_start - decay_start_time
	var end_elapsed := now - decay_start_time
	var elapsed := now - sample_start
	pending_decay += STYLE_DECAY_RATE * elapsed + STYLE_DECAY_ACCELERATION * 0.5 * (end_elapsed * end_elapsed - start_elapsed * start_elapsed)
	var loss := mini(banked_score, int(floor(pending_decay)))
	if loss <= 0:
		last_decay_sample_time = now
		return
	banked_score -= loss
	pending_decay -= loss
	last_decay = loss
	last_decay_sample_time = now
	if banked_score == 0:
		pending_decay = 0.0

func _tier_for_score(score: int) -> String:
	if score >= 50000:
		return "LEGEND"
	if score >= 20000:
		return "WILD"
	if score >= 8000:
		return "CHARGED"
	if score >= 2000:
		return "FLOW"
	return "QUIET"

func _label_for(action: String, was_active: bool) -> String:
	match action:
		"air_dash": return "AIR DASH"
		"sprint_dash": return "SPRINT BURST"
		"slide": return "SLIDE LINK" if was_active else "SLIDE"
		"grapple": return "TETHER"
		"tether_release": return "TETHER SNAP"
		"wall_jump": return "WALL KICK"
		"slam_land": return "SLAM IMPACT"
		"double_jump": return "DOUBLE JUMP"
		"gap": return "GAP"
		"airtime": return "AIRTIME"
		"speed": return "SPEED"
		_: return action.replace("_", " ").to_upper()

func _severity_for(action: String, points: int) -> String:
	if action in ["gap", "slam_land", "slam_bounce", "tether_release"] or points >= 600:
		return "peak"
	if points >= 180 or movement_multiplier >= 1.25:
		return "major"
	return "minor"

func _is_flow_action(action: String) -> bool:
	return action in ["speed", "airtime", "glide", "glide_dive"]

func _transition_for(previous: String, current: String) -> Dictionary:
	if previous.is_empty():
		return {}
	var transition: Variant = TRANSITION_BONUSES.get(previous + ">" + current, {})
	return transition.duplicate(true) if transition is Dictionary else {}
