class_name WildlifeAgent
extends Node3D

const ARCHETYPES := preload("res://scripts/wildlife_archetypes.gd")
const BEHAVIOR := preload("res://scripts/wildlife_behavior.gd")
const ENVIRONMENT := preload("res://scripts/wildlife_environment.gd")

var record: Dictionary = {}
var player: Node3D
var archetype: Dictionary = {}
var warning_issued := false
var territory_center := Vector3.ZERO
var melee_cooldown := 0.0
var impact_velocity := Vector3.ZERO
var surface: Dictionary = {}

func configure(next_record: Dictionary, next_player: Node3D, next_surface: Dictionary = {}) -> void:
	record = next_record.duplicate(true)
	player = next_player
	archetype = ARCHETYPES.by_id(str(record.get("archetype_id", "")))
	surface = next_surface.duplicate(true)

func _ready() -> void:
	territory_center = global_position

func _process(delta: float) -> void:
	melee_cooldown = maxf(0.0, melee_cooldown-delta)
	if impact_velocity.length() > 0.01:
		global_position += impact_velocity*delta
		impact_velocity = impact_velocity.move_toward(Vector3.ZERO, 18.0*delta)
	if player == null or not is_instance_valid(player) or archetype.is_empty(): return
	var behavior: Dictionary = BEHAVIOR.step(archetype, global_position, player.global_position, warning_issued, territory_center)
	warning_issued = bool(behavior.warning_issued)
	set_meta("wildlife_state", str(behavior.state))
	var environment: Dictionary = ENVIRONMENT.evaluate(surface)
	if str(behavior.state) == "flee" and bool(environment.can_move): global_position += (behavior.direction as Vector3) * float(behavior.speed) * float(environment.speed_multiplier) * delta

func register_traversal_hit(state: String, impulse: Vector3 = Vector3.ZERO) -> bool:
	if melee_cooldown > 0.0: return false
	melee_cooldown = 0.4
	impact_velocity += impulse
	set_meta("wildlife_hit", state)
	set_meta("wildlife_state", "flee")
	return true
