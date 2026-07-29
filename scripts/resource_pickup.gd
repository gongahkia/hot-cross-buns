class_name ResourcePickup
extends Area3D

@export var kind := "wood"
@export var amount := 1

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node3D) -> void:
	if not body is SpeedPlayer: return
	Survival.collect(kind, amount)
	RunData.add_resource(kind, amount)
	queue_free()
