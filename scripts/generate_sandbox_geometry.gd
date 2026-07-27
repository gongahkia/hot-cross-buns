extends SceneTree

const MAIN_SCENE := preload("res://scenes/main.tscn")
const OUTPUT_PATH := "res://scenes/sandbox_geometry.tscn"
const LIGHTMAP_TEXEL_SIZE := 0.5

func _initialize() -> void:
	var main := MAIN_SCENE.instantiate()
	root.add_child(main)
	await process_frame
	main.start_level("sandbox")
	await process_frame
	var course: Node3D = main.course
	var player: Node = main.player
	if player:
		course.remove_child(player)
		player.queue_free()
	for trigger in course.find_children("*", "CourseTrigger", true, false):
		(trigger as CourseTrigger).callback = Callable()
	_add_lightmap(course)
	_convert_static_meshes(course)
	_set_owners(course, course)
	var packed := PackedScene.new()
	assert(packed.pack(course) == OK, "could not pack sandbox geometry")
	assert(ResourceSaver.save(packed, OUTPUT_PATH) == OK, "could not save sandbox geometry")
	main.queue_free()
	await process_frame
	quit()

func _add_lightmap(course: Node3D) -> void:
	var lightmap := LightmapGI.new()
	lightmap.name = "BakedLightmap"
	lightmap.bounds = AABB(Vector3(-64.0, -4.0, -166.0), Vector3(128.0, 38.0, 184.0))
	course.add_child(lightmap)

func _convert_static_meshes(node: Node) -> void:
	if node is MeshInstance3D and _is_static_geometry(node):
		var instance := node as MeshInstance3D
		if instance.mesh is PrimitiveMesh:
			instance.mesh = _unwrap_primitive(instance.mesh as PrimitiveMesh)
		instance.gi_mode = GeometryInstance3D.GI_MODE_STATIC
	for child in node.get_children():
		_convert_static_meshes(child)

func _is_static_geometry(node: Node) -> bool:
	var ancestor := node.get_parent()
	while ancestor:
		if ancestor is CourseTrigger:
			return false
		if ancestor is StaticBody3D:
			return true
		ancestor = ancestor.get_parent()
	return false

func _unwrap_primitive(primitive: PrimitiveMesh) -> ArrayMesh:
	var tool := SurfaceTool.new()
	tool.create_from(primitive, 0)
	var mesh := tool.commit()
	assert(mesh.lightmap_unwrap(Transform3D.IDENTITY, LIGHTMAP_TEXEL_SIZE) == OK, "could not unwrap static mesh")
	return mesh

func _set_owners(node: Node, owner: Node) -> void:
	for child in node.get_children():
		child.owner = owner
		_set_owners(child, owner)
