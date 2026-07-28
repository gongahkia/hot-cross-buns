class_name LevelBuilder
extends RefCounted

const LEVEL_DOCUMENT := preload("res://scripts/level_document.gd")

static func build(host: Node, document: Variant, target: Node3D) -> Dictionary:
	var index: Dictionary = build_index(host, document, target)
	return {"modules": document.modules().size(), "routes": index.get("routes", {}).size(), "index": index}

static func build_index(host: Node, document: Variant, target: Node3D) -> Dictionary:
	var world: Dictionary = document.data.get("world", {})
	var palette: Dictionary = host.call("_palette_for", str(world.get("terrain_style", "summit")))
	var width := float(world.get("width", 96.0))
	var length := float(world.get("length", 96.0))
	var basin := host.call("_make_platform", Vector3(0.0, -0.45, -length * 0.5), Vector3(width, 0.9, length), palette.get("basin", Color("#324b32"))) as StaticBody3D
	basin.name = "OpenBasin"
	basin.set_meta("recovery_floor", true)
	target.add_child(basin)
	var routes: Dictionary = {}
	var module_nodes: Dictionary = {}
	var reference_nodes: Dictionary = {}
	for module in document.modules():
		if not module is Dictionary:
			continue
		var route_name := str(module.get("route", "Ungrouped"))
		var parent := _route_parent(target, routes, route_name)
		var node := _build_module(host, parent, module, palette)
		if node:
			node.name = str(module.get("kind", "module")).capitalize() + "_" + str(module.get("id", ""))
			node.set_meta("level_module_id", str(module.get("id", "")))
			node.set_meta("level_module_kind", str(module.get("kind", "")))
			module_nodes[str(module.get("id", ""))] = node
	for reference in document.data.get("references", []):
		if reference is Dictionary:
			var reference_node := _build_reference(target, reference)
			if reference_node:
				reference_nodes[str(reference.get("id", ""))] = reference_node
	return {"routes": routes, "modules": module_nodes, "references": reference_nodes, "basin": basin}

static func apply_changes(host: Node, document: Variant, target: Node3D, index: Dictionary, changed_module_ids: Array, full_rebuild := false, references_changed := false) -> Dictionary:
	if full_rebuild:
		for child in target.get_children():
			target.remove_child(child)
			child.queue_free()
		return build_index(host, document, target)
	var routes: Dictionary = index.get("routes", {})
	var module_nodes: Dictionary = index.get("modules", {})
	var reference_nodes: Dictionary = index.get("references", {})
	for module_id in changed_module_ids:
		var key := str(module_id)
		if key.begins_with("@reference:"):
			references_changed = true
			continue
		if key == "*": return apply_changes(host, document, target, index, [], true, true)
		if module_nodes.has(key) and is_instance_valid(module_nodes[key]):
			var previous: Node3D = module_nodes[key]
			if previous.get_parent(): previous.get_parent().remove_child(previous)
			previous.queue_free()
		module_nodes.erase(key)
		var module: Dictionary = document.module_by_id(key)
		if module.is_empty(): continue
		var route_name := str(module.get("route", "Ungrouped"))
		var parent := _route_parent(target, routes, route_name)
		var world: Dictionary = document.data.get("world", {})
		var palette: Dictionary = host.call("_palette_for", str(world.get("terrain_style", "summit")))
		var node := _build_module(host, parent, module, palette)
		if node:
			node.name = str(module.get("kind", "module")).capitalize() + "_" + key
			node.set_meta("level_module_id", key)
			node.set_meta("level_module_kind", str(module.get("kind", "")))
			module_nodes[key] = node
	if references_changed:
		for reference_id in reference_nodes:
			if is_instance_valid(reference_nodes[reference_id]):
				var previous_reference: Node3D = reference_nodes[reference_id]
				if previous_reference.get_parent(): previous_reference.get_parent().remove_child(previous_reference)
				previous_reference.queue_free()
		reference_nodes.clear()
		for reference in document.data.get("references", []):
			if reference is Dictionary:
				var node := _build_reference(target, reference)
				if node: reference_nodes[str(reference.get("id", ""))] = node
	index["routes"] = routes
	index["modules"] = module_nodes
	index["references"] = reference_nodes
	return index

static func _route_parent(target: Node3D, routes: Dictionary, route_name: String) -> Node3D:
	if routes.has(route_name):
		return routes[route_name]
	var route := Node3D.new()
	route.name = route_name.validate_filename().replace(" ", "_")
	route.set_meta("creative_route", route_name)
	target.add_child(route)
	routes[route_name] = route
	return route

static func _build_module(host: Node, parent: Node3D, module: Dictionary, palette: Dictionary) -> Node3D:
	var kind := str(module.get("kind", ""))
	var position: Variant = LEVEL_DOCUMENT.vector_from(module.get("position", [0.0, 0.0, 0.0]))
	if position == null:
		return null
	var color := _color(module.get("color", ""), _module_color(kind, palette))
	var node: Node3D
	match kind:
		"platform", "wall":
			var size := _vector(module.get("size", [5.0, 0.8, 5.0]), Vector3(5.0, 0.8, 5.0))
			node = host.call("_make_platform", position, size, color) as Node3D
			if kind == "wall": node.rotation.y = float(module.get("rotation_y", 0.0))
		"ramp":
			var start := _vector(module.get("start", LEVEL_DOCUMENT.vector_data(position)), position)
			var end := _vector(module.get("end", LEVEL_DOCUMENT.vector_data(position + Vector3(0.0, 1.8, -8.0))), position + Vector3(0.0, 1.8, -8.0))
			node = host.call("_make_ramp_between", start, end, float(module.get("width", 4.0)), color) as Node3D
		"boost":
			node = host.call("_make_boost", position, _vector(module.get("direction", [0.0, 0.0, -1.0]), Vector3.FORWARD)) as Node3D
		"launch":
			node = host.call("_make_launch", position) as Node3D
		"collectible":
			node = host.call("_make_collectible", position) as Node3D
		"gap":
			node = host.call("_make_combo_gap", position, str(module.get("gap_id", module.get("id", "gap"))), int(module.get("points", 300))) as Node3D
		"recharge":
			node = host.call("_make_recharge_gate", position, str(module.get("tool", "dash")), str(module.get("gate_id", module.get("id", "recharge")))) as Node3D
		"reset":
			node = host.call("_make_reset_pad", position, _vector(module.get("spawn", [0.0, 1.1, 3.0]), Vector3(0.0, 1.1, 3.0)), str(module.get("station", "Creative")), bool(module.get("restart", false))) as Node3D
		"grapple_anchor":
			host.call("_add_grapple_anchor", parent, position, color)
			node = parent.get_child(parent.get_child_count() - 1) as Node3D
		"climbable_trunk":
			host.call("_add_climbable_trunk", position, float(module.get("height", 7.0)), float(module.get("radius", 0.5)), parent)
			node = parent.get_child(parent.get_child_count() - 1) as Node3D
		"building":
			var footprint: Variant = module.get("footprint", [18.0, 18.0])
			var width := float(footprint[0]) if footprint is Array and footprint.size() >= 2 else 18.0
			var depth := float(footprint[1]) if footprint is Array and footprint.size() >= 2 else 18.0
			host.call("_add_interior_building", parent, position, Vector2(width, depth), float(module.get("height", 10.0)), color)
			node = parent.get_child(parent.get_child_count() - 1) as Node3D
		"root_arch":
			host.call("_add_root_arch", parent, position, float(module.get("width", 7.0)), color)
			node = parent.get_child(parent.get_child_count() - 1) as Node3D
		"sign":
			host.call("_add_course_sign", parent, position, str(module.get("text", "CREATIVE")), color)
			node = parent.get_child(parent.get_child_count() - 1) as Node3D
		"route_marker":
			node = _route_marker(position, str(module.get("label", module.get("id", "MARK"))), color)
			parent.add_child(node)
		"checkpoint":
			node = host.call("_make_checkpoint", position, str(module.get("id", "checkpoint"))) as Node3D
		_:
			return null
	if node and node.get_parent() == null:
		parent.add_child(node)
	return node

static func _build_reference(target: Node3D, reference: Dictionary) -> Node3D:
	var path := str(reference.get("path", ""))
	if path.is_empty() or not FileAccess.file_exists(path):
		return null
	var image := Image.load_from_file(ProjectSettings.globalize_path(path))
	if image == null:
		return null
	var texture := ImageTexture.create_from_image(image)
	var overlay := Node3D.new()
	overlay.name = "ReferenceOverlay"
	var mesh := MeshInstance3D.new()
	var quad := QuadMesh.new()
	var size: Variant = reference.get("size", [20.0, 20.0])
	var base_size := Vector2(float(size[0]), float(size[1])) if size is Array and size.size() >= 2 else Vector2(20.0, 20.0)
	var crop: Variant = reference.get("crop", [0.0, 0.0, 1.0, 1.0])
	var crop_data := crop if crop is Array and crop.size() == 4 else [0.0, 0.0, 1.0, 1.0]
	var crop_rect := Rect2(float(crop_data[0]), float(crop_data[1]), clampf(float(crop_data[2]), 0.01, 1.0), clampf(float(crop_data[3]), 0.01, 1.0))
	quad.size = Vector2(base_size.x * crop_rect.size.x, base_size.y * crop_rect.size.y)
	var material := StandardMaterial3D.new()
	material.albedo_texture = texture
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = Color(1.0, 1.0, 1.0, 0.62)
	material.uv1_scale = Vector3(crop_rect.size.x, crop_rect.size.y, 1.0)
	material.uv1_offset = Vector3(crop_rect.position.x, crop_rect.position.y, 0.0)
	quad.material = material
	mesh.mesh = quad
	mesh.rotation.x = -PI * 0.5
	var local_offset := Vector3((crop_rect.position.x + crop_rect.size.x * 0.5 - 0.5) * base_size.x, 0.0, -(crop_rect.position.y + crop_rect.size.y * 0.5 - 0.5) * base_size.y)
	mesh.position = local_offset
	overlay.position = _vector(reference.get("position", [0.0, 0.04, 0.0]), Vector3(0.0, 0.04, 0.0))
	overlay.rotation.y = float(reference.get("rotation_y", 0.0))
	overlay.set_meta("reference_id", str(reference.get("id", "")))
	overlay.set_meta("reference_size", [base_size.x, base_size.y])
	overlay.set_meta("reference_crop", [crop_rect.position.x, crop_rect.position.y, crop_rect.size.x, crop_rect.size.y])
	overlay.add_child(mesh)
	target.add_child(overlay)
	return overlay

static func _route_marker(position: Vector3, text: String, color: Color) -> Node3D:
	var marker := Node3D.new()
	marker.name = "RouteMarker"
	marker.position = position
	var visual := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.28
	sphere.height = 0.56
	visual.mesh = sphere
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = color
	visual.material_override = material
	marker.add_child(visual)
	var label := Label3D.new()
	label.text = text
	label.font_size = 18
	label.outline_size = 3
	label.position = Vector3.UP * 0.55
	label.modulate = color
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	marker.add_child(label)
	return marker

static func _vector(raw: Variant, fallback: Vector3) -> Vector3:
	var result: Variant = LEVEL_DOCUMENT.vector_from(raw)
	return result if result != null else fallback

static func _color(raw: Variant, fallback: Color) -> Color:
	if raw is Color:
		return raw
	if raw is String and not raw.is_empty():
		return Color(raw)
	return fallback

static func _module_color(kind: String, palette: Dictionary) -> Color:
	match kind:
		"platform": return palette.get("safe", Color("#527a48"))
		"wall", "building", "climbable_trunk", "root_arch": return palette.get("rock", Color("#425e3c"))
		"ramp": return palette.get("ramp", Color("#638951"))
		"grapple_anchor", "sign", "route_marker": return palette.get("sign", Color("#c9ec8c"))
		_: return palette.get("finale", Color("#8ab85f"))
