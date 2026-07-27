class_name GrappleReticle
extends Control

const LOCK_SECONDS := 0.42
const LARGE_RADIUS := 58.0
const LOCKED_RADIUS := 18.0

var target_position := Vector2.ZERO
var target_anchor_id := 0
var lock_progress := 0.0
var pulse_time := 0.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	visible = false

func track(anchor: Node3D, screen_position: Vector2) -> void:
	var anchor_id := anchor.get_instance_id()
	if target_anchor_id != anchor_id:
		target_anchor_id = anchor_id
		lock_progress = 0.0
	target_position = screen_position
	visible = true

func clear_target() -> void:
	target_anchor_id = 0
	lock_progress = 0.0
	visible = false

func _process(delta: float) -> void:
	if not visible:
		return
	lock_progress = minf(lock_progress + delta / LOCK_SECONDS, 1.0)
	pulse_time += delta
	queue_redraw()

func _draw() -> void:
	if not visible:
		return
	var locked := ease(lock_progress, -2.0)
	var pulse := sin(pulse_time * 7.0) * 1.4 if lock_progress >= 1.0 else 0.0
	var radius := lerpf(LARGE_RADIUS, LOCKED_RADIUS, locked) + pulse
	var color := Color("#b9f6df", 0.58 + locked * 0.42)
	draw_arc(target_position, radius, 0.0, TAU, 40, color, 2.0, false)
	draw_arc(target_position, radius + 6.0, -PI * 0.24, PI * 0.24, 12, Color("#e9ffe8", 0.82), 1.0, false)
	draw_arc(target_position, radius + 6.0, PI * 0.76, PI * 1.24, 12, Color("#e9ffe8", 0.82), 1.0, false)
	var dot_radius := 2.0 + locked * 2.0
	draw_circle(target_position, dot_radius, Color("#efffe5", 0.9))
