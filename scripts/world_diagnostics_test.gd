extends SceneTree
const DIAGNOSTICS=preload("res://scripts/world_diagnostics.gd")
var failed:=false
func _initialize()->void:
	var text:=DIAGNOSTICS.summary({"elevation":.5,"temperature":.6,"rainfall":.7,"biome":"rainforest","water":false,"scale":"region","scale_factor":4,"region":{"id":"1:2","family":"wilderness"}})
	_expect("NAT E 0.500" in text and "BIOME rainforest" in text and "REGION 1:2" in text and DIAGNOSTICS.summary({})=="NATURAL DATA UNAVAILABLE","diagnostics summary drifted")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
