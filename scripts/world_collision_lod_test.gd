extends SceneTree
const LOD=preload("res://scripts/world_collision_lod.gd")
const MESH=preload("res://scripts/world_collision_mesh.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	_expect(LOD.grid_for_distance(0.0)==16 and LOD.grid_for_distance(1.5)==8 and LOD.grid_for_distance(3.0)==4,"collision LOD thresholds drifted")
	var generator:=GENERATOR.new(4242)
	for grid in [16,8,4]:
		var shape:=MESH.heightmap(generator,GENERATOR.CHUNK_SIZE,3,-2,grid)
		_expect(shape.map_width==grid+1 and shape.map_depth==grid+1,"collision map dimensions drifted")
		_expect(shape.map_data.size()==(grid+1)*(grid+1),"collision map data size drifted")
	quit(1 if failed else 0)
