@tool
extends EditorPlugin

const WUKONG_DOCK := preload("res://addons/wukong/wukong_dock.gd")

var _dock: Control

func _enter_tree() -> void:
	_dock = WUKONG_DOCK.new()
	_dock.editor_interface = get_editor_interface()
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, _dock)

func _exit_tree() -> void:
	remove_control_from_docks(_dock)
	_dock.queue_free()
