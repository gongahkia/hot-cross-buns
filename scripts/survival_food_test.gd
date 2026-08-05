extends SceneTree
const SURVIVAL=preload("res://scripts/survival_state.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var survival:=SURVIVAL.new();survival.begin_run(20260730);survival.hunger=40.0;survival.collect("food",2)
	_expect(survival.consume_food() and is_equal_approx(survival.hunger,74.0) and int(survival.materials.food)==1,"food consumption restoration drifted")
	_expect(survival.consume_food() and int(survival.materials.food)==0 and not survival.consume_food(),"food inventory availability drifted")
	survival.free()
	quit(1 if failed else 0)
