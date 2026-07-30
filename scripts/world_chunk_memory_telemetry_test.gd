extends SceneTree
const TELEMETRY=preload("res://scripts/world_chunk_memory_telemetry.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var snapshot:=TELEMETRY.snapshot([16,8],[16,8],3,7,1024)
	_expect(int(snapshot.active_chunks)==2 and int(snapshot.far_chunks)==3 and int(snapshot.cached_descriptors)==7,"chunk-memory counts drifted")
	_expect(int(snapshot.render_vertices)==1920 and int(snapshot.far_vertices)==72 and int(snapshot.collision_heights)==370,"chunk-memory geometry counts drifted")
	_expect(int(snapshot.render_payload_bytes)==39840 and int(snapshot.collision_payload_bytes)==1480 and int(snapshot.minimum_payload_bytes)==41320 and int(snapshot.static_memory_bytes)==1024,"chunk-memory payload accounting drifted")
	quit(1 if failed else 0)
