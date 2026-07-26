class_name RunGhost
extends Node3D

var frames: Array = []
var frame_index := 0
var mesh: MeshInstance3D

func _ready() -> void:
	name = "PersonalBestGhost"
	mesh = MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.28
	capsule.height = 1.5
	mesh.mesh = capsule
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.35, 0.9, 0.75, 0.42)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.no_depth_test = true
	mesh.material_override = material
	mesh.position.y = 0.75
	add_child(mesh)

func set_frames(new_frames: Array) -> void:
	frames = new_frames
	visible = not frames.is_empty()

func _physics_process(_delta: float) -> void:
	if not RunData.running or frames.is_empty():
		return
	if frame_index >= frames.size():
		visible = false
		return
	var frame: Dictionary = frames[frame_index]
	var point: Array = frame.get("p", [0.0, 0.0, 0.0])
	global_position = Vector3(float(point[0]), float(point[1]), float(point[2]))
	rotation.y = float(frame.get("yaw", 0.0))
	mesh.position.y = 0.48 if bool(frame.get("slide", false)) else 0.75
	frame_index += 1
