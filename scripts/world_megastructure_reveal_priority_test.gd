extends SceneTree

const GENERATOR := preload("res://scripts/world_generator.gd")
const MEGASTRUCTURE_GENERATOR := preload("res://scripts/world_megastructure_generator.gd")

var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260730)
	var source := MEGASTRUCTURE_GENERATOR.new(20260730).generate(Vector3i.ZERO)
	var reveal: Dictionary = (source.get("reveals", []) as Array)[0]
	var foreground := _chunk_at_bounds(reveal.get("foreground_bounds", {}) as Dictionary)
	var focus := _chunk_at_bounds(reveal.get("focus_bounds", {}) as Dictionary)
	var background := _chunk_at_bounds(reveal.get("background_bounds", {}) as Dictionary)
	var anchor: Array = reveal.get("recommended_view_anchor", [])
	var anchor_chunk := Vector2i(floori(float(anchor[0]) / GENERATOR.CHUNK_SIZE), floori(float(anchor[2]) / GENERATOR.CHUNK_SIZE))
	var foreground_priority := generator.megastructure_reveal_priority(foreground.x, foreground.y)
	var focus_priority := generator.megastructure_reveal_priority(focus.x, focus.y)
	var background_priority := generator.megastructure_reveal_priority(background.x, background.y)
	_expect(foreground_priority >= focus_priority and focus_priority >= background_priority and background_priority > 0.0 and generator.megastructure_reveal_priority(anchor_chunk.x, anchor_chunk.y) >= foreground_priority, "reveal priority tiers drifted")
	var quiet := _quiet_chunk(generator)
	_expect(generator.megastructure_reveal_priority(quiet.x, quiet.y) == 0.0 and generator.megastructure_reveal_priority(foreground.x, foreground.y) == foreground_priority, "reveal priority lost deterministic isolation")
	quit(1 if failed else 0)

func _chunk_at_bounds(bounds: Dictionary) -> Vector2i:
	var minimum: Array = bounds.get("min", [])
	var maximum: Array = bounds.get("max", [])
	return Vector2i(floori((float(minimum[0]) + float(maximum[0])) * 0.5 / GENERATOR.CHUNK_SIZE), floori((float(minimum[2]) + float(maximum[2])) * 0.5 / GENERATOR.CHUNK_SIZE))

func _quiet_chunk(generator: WorldGenerator) -> Vector2i:
	for z in range(-12, 13):
		for x in range(-12, 13):
			if generator.megastructure_reveal_priority(x, z) == 0.0:
				return Vector2i(x, z)
	return Vector2i(100, 100)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
