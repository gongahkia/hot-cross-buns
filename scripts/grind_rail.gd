class_name GrindRail
extends Node3D

@export var rail_points := PackedVector3Array()
@export var activation_radius := 1.45
@export var speed_boost := 3.5

var _segment_lengths := PackedFloat32Array()
var _length := 0.0

func _ready() -> void:
	add_to_group("grind_rail")
	_rebuild_cache()
	_build_visuals()

func length() -> float:
	return _length

func closest_sample(world_position: Vector3) -> Dictionary:
	if rail_points.size() < 2:
		return {}
	var closest_distance := INF
	var result := {}
	var distance_from_start := 0.0
	for index in range(rail_points.size() - 1):
		var start := to_global(rail_points[index])
		var end := to_global(rail_points[index + 1])
		var segment := end - start
		var segment_length := segment.length()
		if is_zero_approx(segment_length):
			continue
		var progress := clampf((world_position - start).dot(segment) / (segment_length * segment_length), 0.0, 1.0)
		var point := start.lerp(end, progress)
		var distance := world_position.distance_to(point)
		if distance < closest_distance:
			closest_distance = distance
			result = {"distance": distance, "rail_distance": distance_from_start + segment_length * progress, "position": point, "tangent": segment / segment_length}
		distance_from_start += segment_length
	return result

func sample(distance_along_rail: float) -> Dictionary:
	if rail_points.size() < 2 or _length <= 0.0:
		return {}
	var clamped_distance := clampf(distance_along_rail, 0.0, _length)
	var traversed := 0.0
	for index in range(_segment_lengths.size()):
		var segment_length := _segment_lengths[index]
		if clamped_distance <= traversed + segment_length or index == _segment_lengths.size() - 1:
			var start := to_global(rail_points[index])
			var end := to_global(rail_points[index + 1])
			var tangent := (end - start).normalized()
			var progress := (clamped_distance - traversed) / segment_length
			return {"position": start.lerp(end, progress), "tangent": tangent}
		traversed += segment_length
	return {}

func _rebuild_cache() -> void:
	_segment_lengths.clear()
	_length = 0.0
	for index in range(maxi(rail_points.size() - 1, 0)):
		var segment_length := rail_points[index].distance_to(rail_points[index + 1])
		_segment_lengths.append(segment_length)
		_length += segment_length

func _build_visuals() -> void:
	if rail_points.size() < 2 or get_node_or_null("RailVisuals"):
		return
	var visuals := Node3D.new()
	visuals.name = "RailVisuals"
	add_child(visuals)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("#b9f6df")
	material.emission_enabled = true
	material.emission = Color("#7ee7c0")
	material.emission_energy_multiplier = 1.8
	for index in range(rail_points.size() - 1):
		var start := rail_points[index]
		var end := rail_points[index + 1]
		var segment := end - start
		var segment_length := segment.length()
		if is_zero_approx(segment_length):
			continue
		var visual := MeshInstance3D.new()
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.09
		mesh.bottom_radius = 0.09
		mesh.height = segment_length
		visual.mesh = mesh
		visual.material_override = material
		visual.position = (start + end) * 0.5
		visual.basis = Basis(Quaternion(Vector3.UP, segment / segment_length))
		visuals.add_child(visual)
