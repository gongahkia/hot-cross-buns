extends SceneTree

const GENERATOR = preload("res://scripts/world_generator.gd")
const COLLISION_MESH = preload("res://scripts/world_collision_mesh.gd")
const EPSILON := 0.00001
var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260730)
	_assert_x_seam(generator, -1, 0, 16, 16)
	_assert_x_seam(generator, -1, 0, 16, 8)
	_assert_z_seam(generator, -1, 0, 16, 16)
	_assert_z_seam(generator, -1, 0, 8, 4)
	var scene := load("res://scenes/main.tscn") as PackedScene
	var main := scene.instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("expedition")
	await physics_frame
	await physics_frame
	_assert_loaded_physics_seam(main)
	main.queue_free()
	await process_frame
	quit(1 if failed else 0)

func _assert_x_seam(generator: WorldGenerator, west_x: int, east_x: int, west_grid: int, east_grid: int) -> void:
	var west := COLLISION_MESH.heightmap(generator, GENERATOR.CHUNK_SIZE, west_x, 0, west_grid)
	var east := COLLISION_MESH.heightmap(generator, GENERATOR.CHUNK_SIZE, east_x, 0, east_grid)
	for index in range(east_grid + 1):
		var west_index := index * west_grid / east_grid
		var west_height := _height(west, west_grid, west_grid, west_index)
		var east_height := _height(east, east_grid, 0, index)
		var world_z := float(index) * GENERATOR.CHUNK_SIZE / float(east_grid)
		var expected := float(generator.sample(float(east_x) * GENERATOR.CHUNK_SIZE, world_z).elevation)
		_expect(absf(west_height - east_height) <= EPSILON and absf(west_height - expected) <= EPSILON, "x collision seam drifted")

func _assert_z_seam(generator: WorldGenerator, north_z: int, south_z: int, north_grid: int, south_grid: int) -> void:
	var north := COLLISION_MESH.heightmap(generator, GENERATOR.CHUNK_SIZE, 0, north_z, north_grid)
	var south := COLLISION_MESH.heightmap(generator, GENERATOR.CHUNK_SIZE, 0, south_z, south_grid)
	for index in range(south_grid + 1):
		var north_index := index * north_grid / south_grid
		var north_height := _height(north, north_grid, north_index, north_grid)
		var south_height := _height(south, south_grid, index, 0)
		var world_x := float(index) * GENERATOR.CHUNK_SIZE / float(south_grid)
		var expected := float(generator.sample(world_x, float(south_z) * GENERATOR.CHUNK_SIZE).elevation)
		_expect(absf(north_height - south_height) <= EPSILON and absf(north_height - expected) <= EPSILON, "z collision seam drifted")

func _assert_loaded_physics_seam(main: Node3D) -> void:
	var state := main.get_world_3d().direct_space_state
	for position in [Vector3(0.0,0.0,-32.0),Vector3(0.0,0.0,32.0),Vector3(-32.0,0.0,0.0),Vector3(32.0,0.0,0.0)]:
		var query := PhysicsRayQueryParameters3D.create(position + Vector3.UP * 128.0, position + Vector3.DOWN * 128.0)
		query.exclude = [main.player.get_rid()]
		var hit: Dictionary = state.intersect_ray(query)
		var expected: float = main.world_streamer.ground_height(position)
		_expect(not hit.is_empty() and absf(float((hit.get("position", Vector3.ZERO) as Vector3).y) - expected) <= EPSILON, "loaded terrain collision seam drifted")

func _height(shape: HeightMapShape3D, grid: int, x: int, z: int) -> float:
	return float(shape.map_data[z * (grid + 1) + x]) * GENERATOR.CHUNK_SIZE / float(grid)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
