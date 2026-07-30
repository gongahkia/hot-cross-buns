extends SceneTree
const PLACEMENT=preload("res://scripts/world_resource_placement.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var first:Dictionary={};var chunk:=Vector2i.ZERO
	for z in range(-8,9):
		for x in range(-8,9):
			var candidate:=PLACEMENT.for_chunk(20260730,x,z,"flooded_city")
			if not candidate.is_empty():first=candidate;chunk=Vector2i(x,z);break
		if not first.is_empty():break
	_expect(not first.is_empty() and str(first.kind) in ["scrap","water","food"] and float(first.local_x)>=8.0 and float(first.local_x)<=56.0 and float(first.local_z)>=8.0 and float(first.local_z)<=56.0,"resource placement bounds or kind drifted")
	_expect(first==PLACEMENT.for_chunk(20260730,chunk.x,chunk.y,"flooded_city"),"resource placement is not deterministic")
	first["kind"]="changed";_expect(str(PLACEMENT.for_chunk(20260730,chunk.x,chunk.y,"flooded_city").kind)!="changed","resource placement leaked mutable state")
	quit(1 if failed else 0)
