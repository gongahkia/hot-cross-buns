extends SceneTree
const SURVIVAL=preload("res://scripts/survival_state.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var survival:=SURVIVAL.new();survival.begin_run(20260730);survival.thirst=30.0
	_expect(survival.collect_water_source({"water":true,"region":{"family":"wilderness"}})=="water" and survival.consume_water() and is_equal_approx(survival.thirst,72.0),"fresh-water sourcing/consumption drifted")
	_expect(survival.collect_water_source({"biome":"lagoon","region":{"family":"flooded_city"}})=="dirty_water" and int(survival.materials.dirty_water)==1 and survival.purify_water() and int(survival.materials.water)==1,"contaminated-water purification drifted")
	_expect(survival.collect_water_source({"biome":"grassland","region":{"family":"wilderness"}}).is_empty() and not survival.purify_water(),"invalid water sourcing/purification drifted")
	survival.free();quit(1 if failed else 0)
