extends SceneTree
const ECOLOGY = preload("res://scripts/world_wildlife_ecology.gd")
const MELEE = preload("res://scripts/traversal_melee.gd")
const SLIDE = preload("res://scripts/slide_impact.gd")
const SLAM = preload("res://scripts/slam_impact.gd")
const GRAPPLE = preload("res://scripts/grapple_impact.gd")
var failed := false
func _initialize() -> void:
	var descriptor := {"region":{"family":"wilderness"},"biome":"temperate_forest","water":false}
	_expect(ECOLOGY.generate(20260730, 4, -2, descriptor) == ECOLOGY.generate(20260730, 4, -2, descriptor), "wildlife spawn determinism drifted")
	for scenario: Dictionary in [{"state":"slide","speed":12.0,"target":Vector3(2.2,0.0,0.0),"impact":SLIDE.resolve(12.0,Vector3.RIGHT)},{"state":"slam","speed":16.0,"target":Vector3(3.0,0.0,0.0),"impact":SLAM.resolve(16.0,Vector3.ZERO,Vector3.RIGHT)},{"state":"grapple","speed":18.0,"target":Vector3(2.6,0.0,0.0),"impact":GRAPPLE.resolve(18.0,Vector3.RIGHT)}]:
		var first: Dictionary = MELEE.hit(str(scenario.state), float(scenario.speed), Vector3.ZERO, scenario.target)
		_expect(first == MELEE.hit(str(scenario.state), float(scenario.speed), Vector3.ZERO, scenario.target) and bool(first.hit) and scenario.impact == scenario.impact, "traversal combat determinism drifted: "+str(scenario.state))
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
