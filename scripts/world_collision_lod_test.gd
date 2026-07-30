extends SceneTree
const LOD=preload("res://scripts/world_collision_lod.gd")
const MESH=preload("res://scripts/world_collision_mesh.gd")
const HANDOFF=preload("res://scripts/world_collision_handoff.gd")
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
	var body:=StaticBody3D.new();var previous:=CollisionShape3D.new();previous.name="Collision";body.add_child(previous)
	var replacement:=CollisionShape3D.new();var retiring:=HANDOFF.install(body,replacement)
	_expect(retiring==previous and previous.get_parent()==body and previous.name=="RetiringCollision" and body.get_node_or_null("Collision")==replacement,"collision handoff removed support before replacement")
	get_root().add_child(body);HANDOFF.retire_after_physics_frame(self,retiring)
	await physics_frame;await process_frame
	_expect(not is_instance_valid(retiring),"retiring collision survived its handoff tick")
	body.queue_free();await process_frame
	quit(1 if failed else 0)
