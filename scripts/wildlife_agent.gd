class_name WildlifeAgent
extends Node3D

const ARCHETYPES := preload("res://scripts/wildlife_archetypes.gd")
const BEHAVIOR := preload("res://scripts/wildlife_behavior.gd")

var record: Dictionary = {}
var player: Node3D
var archetype: Dictionary = {}
var warning_issued := false
var territory_center := Vector3.ZERO

func configure(next_record: Dictionary, next_player: Node3D) -> void:
	record = next_record.duplicate(true)
	player = next_player
	archetype = ARCHETYPES.by_id(str(record.get("archetype_id", "")))

func _ready() -> void:
	territory_center = global_position

func _process(delta: float) -> void:
	if player == null or not is_instance_valid(player) or archetype.is_empty(): return
	var behavior: Dictionary = BEHAVIOR.step(archetype, global_position, player.global_position, warning_issued, territory_center)
	warning_issued = bool(behavior.warning_issued)
	set_meta("wildlife_state", str(behavior.state))
	if str(behavior.state) == "flee": global_position += (behavior.direction as Vector3) * float(behavior.speed) * delta
