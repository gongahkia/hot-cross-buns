extends Node

const SAVE_PATH := "user://a_slow_walk_settings.json"
const ACTIONS := ["move_forward", "move_back", "move_left", "move_right", "look_left", "look_right", "look_up", "look_down", "jump", "slam", "dash", "sprint", "slide", "grapple", "glide", "consume_food", "collect_water", "purify_water", "consume_water", "place_material", "build_shelter", "build_platform", "craft_filter", "extract", "reset_run", "pause"]
const PIXEL_FILTER_OFF := 0
const PIXEL_FILTER_2X := 2
const PIXEL_FILTER_4X := 4

signal pixel_filter_mode_changed(mode: int)

var mouse_sensitivity := 0.0022
var invert_y := false
var slide_toggle := false
var tether_toggle := false
var master_volume := 0.8
var ambient_volume := 0.55
var sfx_volume := 0.75
var pixel_filter_mode := PIXEL_FILTER_4X
var reduce_screen_effects := false
var wildlife_encounters := true
var bindings: Dictionary = {}

func _ready() -> void:
	load_settings()
	apply_bindings()

func default_binding_data() -> Dictionary:
	return {
		"move_forward": [{"type": "key", "code": KEY_W}, {"type": "joy_axis", "axis": JOY_AXIS_LEFT_Y, "value": -1.0}],
		"move_back": [{"type": "key", "code": KEY_S}, {"type": "joy_axis", "axis": JOY_AXIS_LEFT_Y, "value": 1.0}],
		"move_left": [{"type": "key", "code": KEY_A}, {"type": "joy_axis", "axis": JOY_AXIS_LEFT_X, "value": -1.0}],
		"move_right": [{"type": "key", "code": KEY_D}, {"type": "joy_axis", "axis": JOY_AXIS_LEFT_X, "value": 1.0}],
		"look_left": [{"type": "key", "code": KEY_LEFT}],
		"look_right": [{"type": "key", "code": KEY_RIGHT}],
		"look_up": [{"type": "key", "code": KEY_UP}],
		"look_down": [{"type": "key", "code": KEY_DOWN}],
		"jump": [{"type": "key", "code": KEY_SPACE}, {"type": "joy_button", "button": JOY_BUTTON_A}],
		"slam": [{"type": "key", "code": KEY_Q}, {"type": "joy_button", "button": JOY_BUTTON_LEFT_SHOULDER}],
		"dash": [{"type": "key", "code": KEY_SHIFT}, {"type": "joy_button", "button": JOY_BUTTON_RIGHT_SHOULDER}],
		"sprint": [{"type": "key", "code": KEY_CTRL}, {"type": "joy_button", "button": JOY_BUTTON_LEFT_STICK}],
		"slide": [{"type": "key", "code": KEY_C}, {"type": "joy_button", "button": JOY_BUTTON_B}],
		"grapple": [{"type": "key", "code": KEY_E}, {"type": "joy_button", "button": JOY_BUTTON_X}],
		"glide": [{"type": "key", "code": KEY_F}, {"type": "joy_button", "button": JOY_BUTTON_DPAD_UP}],
		"consume_food": [{"type": "key", "code": KEY_1}, {"type": "joy_button", "button": JOY_BUTTON_DPAD_LEFT}],
		"collect_water": [{"type": "key", "code": KEY_2}],
		"purify_water": [{"type": "key", "code": KEY_3}],
		"consume_water": [{"type": "key", "code": KEY_4}, {"type": "joy_button", "button": JOY_BUTTON_DPAD_RIGHT}],
		"place_material": [{"type": "key", "code": KEY_5}],
		"build_shelter": [{"type": "key", "code": KEY_6}],
		"build_platform": [{"type": "key", "code": KEY_7}],
		"craft_filter": [{"type": "key", "code": KEY_8}],
		"extract": [{"type": "key", "code": KEY_X}],
		"reset_run": [{"type": "key", "code": KEY_R}, {"type": "joy_button", "button": JOY_BUTTON_Y}],
		"pause": [{"type": "key", "code": KEY_ESCAPE}, {"type": "joy_button", "button": JOY_BUTTON_START}]
	}

func load_settings() -> void:
	bindings = default_binding_data()
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	var parsed = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return
	mouse_sensitivity = float(parsed.get("mouse_sensitivity", mouse_sensitivity))
	invert_y = bool(parsed.get("invert_y", invert_y))
	slide_toggle = bool(parsed.get("slide_toggle", slide_toggle))
	tether_toggle = bool(parsed.get("tether_toggle", tether_toggle))
	master_volume = float(parsed.get("master_volume", master_volume))
	ambient_volume = float(parsed.get("ambient_volume", ambient_volume))
	sfx_volume = float(parsed.get("sfx_volume", sfx_volume))
	pixel_filter_mode = _normalized_pixel_filter_mode(int(parsed.get("pixel_filter_mode", pixel_filter_mode)))
	reduce_screen_effects = bool(parsed.get("reduce_screen_effects", reduce_screen_effects))
	wildlife_encounters = bool(parsed.get("wildlife_encounters", wildlife_encounters))
	var saved_bindings = parsed.get("bindings", {})
	if saved_bindings is Dictionary:
		for action in ACTIONS:
			if saved_bindings.has(action):
				bindings[action] = saved_bindings[action]
		_migrate_ctrl_slide_binding(saved_bindings)

func save_settings() -> void:
	var data := {
		"mouse_sensitivity": mouse_sensitivity,
		"invert_y": invert_y,
		"slide_toggle": slide_toggle,
		"tether_toggle": tether_toggle,
		"master_volume": master_volume,
		"ambient_volume": ambient_volume,
		"sfx_volume": sfx_volume,
		"pixel_filter_mode": pixel_filter_mode,
		"reduce_screen_effects": reduce_screen_effects,
		"wildlife_encounters": wildlife_encounters,
		"bindings": bindings
	}
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	file.store_string(JSON.stringify(data))

func apply_bindings() -> void:
	for action in ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		InputMap.action_erase_events(action)
		var action_bindings = bindings.get(action, [])
		for binding in action_bindings:
			var event := event_from_data(binding)
			if event:
				InputMap.action_add_event(action, event)

func set_binding(action: String, event: InputEvent) -> void:
	if not ACTIONS.has(action):
		return
	var data := data_from_event(event)
	if data.is_empty():
		return
	bindings[action] = [data]
	apply_bindings()
	save_settings()

func set_pixel_filter_mode(mode: int) -> void:
	var normalized := _normalized_pixel_filter_mode(mode)
	if pixel_filter_mode == normalized:
		return
	pixel_filter_mode = normalized
	save_settings()
	pixel_filter_mode_changed.emit(pixel_filter_mode)

func _normalized_pixel_filter_mode(mode: int) -> int:
	match mode:
		PIXEL_FILTER_2X, PIXEL_FILTER_4X:
			return mode
		_:
			return PIXEL_FILTER_OFF

func event_from_data(data: Dictionary) -> InputEvent:
	match String(data.get("type", "")):
		"key":
			var event := InputEventKey.new()
			event.keycode = int(data.get("code", 0))
			return event
		"joy_button":
			var event := InputEventJoypadButton.new()
			event.button_index = int(data.get("button", 0))
			return event
		"joy_axis":
			var event := InputEventJoypadMotion.new()
			event.axis = int(data.get("axis", 0))
			event.axis_value = float(data.get("value", 0.0))
			return event
	return null

func data_from_event(event: InputEvent) -> Dictionary:
	if event is InputEventKey and event.keycode != KEY_NONE:
		return {"type": "key", "code": event.keycode}
	if event is InputEventJoypadButton and event.pressed:
		return {"type": "joy_button", "button": event.button_index}
	return {}

func binding_label(action: String) -> String:
	var action_bindings = bindings.get(action, [])
	if action_bindings.is_empty():
		return "Unbound"
	var event := event_from_data(action_bindings[0])
	return event.as_text().replace(" (Physical)", "") if event else "Unbound"

func _migrate_ctrl_slide_binding(saved_bindings: Dictionary) -> void:
	var saved_slide = saved_bindings.get("slide", [])
	if not saved_slide is Array or saved_slide.size() != 1:
		return
	var binding = saved_slide[0]
	if not binding is Dictionary or String(binding.get("type", "")) != "key" or int(binding.get("code", 0)) != KEY_CTRL:
		return
	bindings["slide"] = default_binding_data()["slide"]
