extends SceneTree
const ARCHETYPES = preload("res://scripts/wildlife_archetypes.gd")
const POLICY = preload("res://scripts/wildlife_encounter_policy.gd")
var failed := false
func _initialize() -> void:
	var records: Array = ARCHETYPES.all()
	_expect(records.map(func(record: Dictionary): return str(record.id)) == ["ruin_fox","swift_deer","territorial_boar"], "wildlife archetypes drifted")
	var deer: Dictionary = ARCHETYPES.by_id("swift_deer")
	_expect(POLICY.decide(deer, {"player_distance":29.0}).state == "idle" and POLICY.decide(deer, {"player_distance":12.0}).state == "flee", "flee-first awareness drifted")
	var boar: Dictionary = ARCHETYPES.by_id("territorial_boar")
	_expect(POLICY.decide(boar, {"player_distance":8.0,"territory_intrusion":true}).state == "warn" and POLICY.decide(boar, {"player_distance":8.0,"territory_intrusion":true,"warning_issued":true}).state == "flee", "territorial warning policy drifted")
	_expect(POLICY.decide({}, {}).reason == "unknown_archetype" and POLICY.decide(deer, {"player_distance":2.0,"has_line_of_sight":false}).state == "idle", "encounter ignore policy drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
