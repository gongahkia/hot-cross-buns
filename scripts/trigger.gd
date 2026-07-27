class_name CourseTrigger
extends Area3D

enum TriggerType { COLLECTIBLE, BOOST, LAUNCH, COMBO_GAP, RESET }

var trigger_type: TriggerType
var payload: Variant
var consumed := false
var callback: Callable

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node3D) -> void:
	if consumed or not (body is CharacterBody3D):
		return
	if trigger_type == TriggerType.COLLECTIBLE:
		consumed = true
		queue_free()
	callback.call(trigger_type, payload)
