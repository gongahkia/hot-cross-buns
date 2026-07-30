extends SceneTree
const LANDMARKS=preload("res://scripts/world_landmarks.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var state=LANDMARKS.new();var region:Dictionary={"id":"-2:3","x":-2,"z":3,"landmark":"radio mast"};var first:=state.record_for(20260730,region)
	_expect(not first.is_empty() and int(first.chunk_x)>=-16 and int(first.chunk_x)<=-9 and int(first.chunk_z)>=24 and int(first.chunk_z)<=31,"landmark escaped its region")
	_expect(first==state.for_chunk(20260730,region,int(first.chunk_x),int(first.chunk_z)),"landmark changed after chunk reload")
	_expect(state.for_chunk(20260730,region,int(first.chunk_x)+8,int(first.chunk_z)).is_empty(),"landmark leaked into a second chunk")
	first["kind"]="changed";_expect(str(state.record_for(20260730,region).kind)=="radio mast" and state.record_for(20260730,region)==LANDMARKS.new().record_for(20260730,region),"landmark record is not persistent and deterministic")
	quit(1 if failed else 0)
