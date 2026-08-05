class_name WorldCollisionHandoff
extends RefCounted

static func install(body:StaticBody3D,replacement:CollisionShape3D)->CollisionShape3D:
	var retiring:=body.get_node_or_null("Collision") as CollisionShape3D
	if retiring:retiring.name="RetiringCollision"
	replacement.name="Collision";body.add_child(replacement)
	return retiring

static func retire_after_physics_frame(tree:SceneTree,collision:CollisionShape3D)->void:
	await tree.physics_frame
	if is_instance_valid(collision):collision.queue_free()
