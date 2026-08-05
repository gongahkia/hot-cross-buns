extends SceneTree

const PLAYER = preload("res://scripts/player.gd")
const SURVIVAL = preload("res://scripts/survival_state.gd")

var failed := false

func _initialize() -> void:
	var survival := SURVIVAL.new()
	survival.begin_run(20260730)
	survival.apply_injury(20.0)
	survival.advance(10.0, {"temperature": 0.55, "rainfall": 0.0}, false)
	var recovered := survival.snapshot()
	_expect(float(recovered.injury) < 20.0 and float(recovered.health) > 80.0, "rest recovery drifted")
	survival.advance(10.0, {"temperature": 0.55, "rainfall": 0.0}, true)
	var exerting := survival.snapshot()
	survival.advance(10.0, {"temperature": 0.55, "rainfall": 0.0}, false)
	_expect(float(exerting.fatigue) > float(survival.snapshot().fatigue), "fatigue recovery drifted")
	var player := PLAYER.new()
	player.is_sprinting = true
	_expect(is_equal_approx(player._movement_top_speed(true), PLAYER.SPRINT_SPEED), "base sprint speed drifted")
	player.set_survival_speed_multiplier(0.65)
	_expect(is_equal_approx(player._movement_top_speed(true), PLAYER.SPRINT_SPEED * 0.65) and player.survival_movement_state() == "sprint", "movement penalty drifted")
	_expect(is_zero_approx(PLAYER.landing_injury(-PLAYER.INJURY_LANDING_SPEED)) and is_equal_approx(PLAYER.landing_injury(-16.0), 6.0), "landing injury drifted")
	player.free()
	survival.free()
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
