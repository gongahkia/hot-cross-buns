class_name SandboxGeometryExporter
extends RefCounted

const LIGHTMAP_TEXEL_SIZE := 0.5

static func export_course(course: Node3D, player: Node, output_path: String) -> Error:
	if player:
		course.remove_child(player)
		player.queue_free()
	for trigger in course.find_children("*", "CourseTrigger", true, false):
		(trigger as CourseTrigger).callback = Callable()
	_add_lightmap(course)
	_add_lighting(course)
	_convert_static_meshes(course)
	_set_owners(course, course)
	var packed := PackedScene.new()
	var pack_error := packed.pack(course)
	if pack_error != OK:
		return pack_error
	return ResourceSaver.save(packed, output_path)

static func _add_lightmap(course: Node3D) -> void:
	var lightmap := LightmapGI.new()
	lightmap.name = "BakedLightmap"
	lightmap.bounces = 1
	lightmap.quality = LightmapGI.BAKE_QUALITY_LOW
	lightmap.texel_scale = 0.5
	lightmap.generate_probes_subdiv = LightmapGI.GENERATE_PROBES_SUBDIV_8
	course.add_child(lightmap)

static func _add_lighting(course: Node3D) -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("#17231d")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("#92a87d")
	settings.ambient_light_energy = 0.55
	settings.fog_enabled = true
	settings.fog_light_color = Color("#5f765f")
	settings.fog_light_energy = 0.65
	settings.fog_density = 0.008
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.environment = settings
	course.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.name = "BakedSun"
	sun.rotation_degrees = Vector3(-52.0, -36.0, 0.0)
	sun.light_color = Color("#d4d7ac")
	sun.light_energy = 1.25
	sun.light_bake_mode = Light3D.BAKE_STATIC
	sun.shadow_enabled = false
	course.add_child(sun)
	var fill := OmniLight3D.new()
	fill.name = "BakedFill"
	fill.position = Vector3(0.0, 9.0, 3.0)
	fill.light_color = Color("#78966c")
	fill.omni_range = 30.0
	fill.light_energy = 1.2
	fill.light_bake_mode = Light3D.BAKE_STATIC
	fill.shadow_enabled = false
	course.add_child(fill)

static func _convert_static_meshes(node: Node) -> void:
	if node is MeshInstance3D and _is_static_geometry(node):
		var instance := node as MeshInstance3D
		if instance.mesh is PrimitiveMesh:
			instance.mesh = _unwrap_primitive(instance.mesh as PrimitiveMesh)
		instance.gi_mode = GeometryInstance3D.GI_MODE_STATIC
	for child in node.get_children():
		_convert_static_meshes(child)

static func _is_static_geometry(node: Node) -> bool:
	var ancestor := node.get_parent()
	while ancestor:
		if ancestor is CourseTrigger:
			return false
		if ancestor is StaticBody3D:
			return true
		ancestor = ancestor.get_parent()
	return false

static func _unwrap_primitive(primitive: PrimitiveMesh) -> ArrayMesh:
	var tool := SurfaceTool.new()
	tool.create_from(primitive, 0)
	var mesh := tool.commit()
	assert(mesh.lightmap_unwrap(Transform3D.IDENTITY, LIGHTMAP_TEXEL_SIZE) == OK, "could not unwrap static mesh")
	return mesh

static func _set_owners(node: Node, owner: Node) -> void:
	for child in node.get_children():
		child.owner = owner
		_set_owners(child, owner)
