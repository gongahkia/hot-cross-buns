extends SceneTree
const POLICY=preload("res://scripts/survival_movement_policy.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var healthy:Dictionary={"hunger":100.0,"thirst":100.0,"warmth":100.0,"health":100.0,"fatigue":0.0,"alive":true};var strained:Dictionary={"hunger":75.0,"thirst":75.0,"warmth":75.0,"health":75.0,"fatigue":25.0,"alive":true};var critical:Dictionary={"hunger":0.0,"thirst":0.0,"warmth":0.0,"health":0.0,"fatigue":100.0,"alive":true};var sprint:=POLICY.evaluate(strained,"sprint");var walk:=POLICY.evaluate(strained,"walk")
	for state:String in POLICY.STATES:_expect(bool(POLICY.evaluate(healthy,state).allowed) and is_equal_approx(float(POLICY.evaluate(healthy,state).speed_multiplier),1.0),"healthy movement policy drifted")
	_expect(bool(sprint.allowed) and float(sprint.speed_multiplier)>=POLICY.MIN_SPEED_MULTIPLIER and float(sprint.speed_multiplier)<float(walk.speed_multiplier) and float(sprint.recovery_pressure)>0.0 and is_equal_approx(float(POLICY.evaluate(critical,"walk").speed_multiplier),POLICY.MIN_SPEED_MULTIPLIER),"movement policy weighting/floor drifted")
	_expect(not bool(POLICY.evaluate({"alive":false},"walk").allowed) and POLICY.evaluate(critical,"dash")==POLICY.evaluate(critical,"dash"),"movement policy availability/determinism drifted")
	quit(1 if failed else 0)
