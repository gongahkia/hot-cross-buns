extends SceneTree
const PLACEMENT=preload("res://scripts/world_hazard_placement.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	_expect(PLACEMENT.kind_for("lava_flow","wilderness")=="thermal" and PLACEMENT.kind_for("karst","wilderness")=="sinkhole" and PLACEMENT.kind_for("temperate_forest","industrial_ruin")=="contamination" and PLACEMENT.kind_for("temperate_forest","wilderness").is_empty(),"hazard classification drifted")
	var first:Dictionary={};var chunk:=Vector2i.ZERO
	for z in range(-8,9):
		for x in range(-8,9):
			var candidate:=PLACEMENT.for_chunk(20260730,x,z,"temperate_forest","industrial_ruin")
			if not candidate.is_empty():first=candidate;chunk=Vector2i(x,z);break
		if not first.is_empty():break
	_expect(not first.is_empty() and str(first.kind)=="contamination" and float(first.local_x)>=10.0 and float(first.local_x)<=54.0 and float(first.local_z)>=10.0 and float(first.local_z)<=54.0,"hazard placement bounds or kind drifted")
	_expect(first==PLACEMENT.for_chunk(20260730,chunk.x,chunk.y,"temperate_forest","industrial_ruin"),"hazard placement is not deterministic")
	first["kind"]="changed";_expect(str(PLACEMENT.for_chunk(20260730,chunk.x,chunk.y,"temperate_forest","industrial_ruin").kind)=="contamination","hazard placement leaked mutable state")
	quit(1 if failed else 0)
