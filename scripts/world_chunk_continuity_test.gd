extends SceneTree
const GENERATOR = preload("res://scripts/world_generator.gd")
var failed := false
func _initialize() -> void:
	var generator=GENERATOR.new(20260730); var size:=float(GENERATOR.CHUNK_SIZE)
	for index in range(-8,9):
		var coordinate:=float(index)*size
		_expect(generator.sample(coordinate,17.0)==generator.sample(float(index)*size,17.0),"x seam sample drifted")
		_expect(generator.sample(23.0,coordinate)==generator.sample(23.0,float(index)*size),"z seam sample drifted")
	var west:=generator.chunk_descriptor(-1,0); var east:=generator.chunk_descriptor(0,0)
	_expect(west==generator.chunk_descriptor(-1,0) and east==generator.chunk_descriptor(0,0),"chunk descriptor seam determinism drifted")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true; push_error(message)
