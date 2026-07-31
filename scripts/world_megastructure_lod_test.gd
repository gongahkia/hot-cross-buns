extends SceneTree

const GENERATOR := preload("res://scripts/world_generator.gd")
const MEGASTRUCTURE_GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const LOD := preload("res://scripts/world_megastructure_lod.gd")

var failed := false

func _initialize() -> void:
	var generator := GENERATOR.new(20260730)
	var source := MEGASTRUCTURE_GENERATOR.new(20260730).generate(Vector3i.ZERO)
	var approach: Array = (source.get("entry", {}) as Dictionary).get("approach_anchor", [])
	var chunk := Vector2i(floori(float(approach[0]) / GENERATOR.CHUNK_SIZE), floori(float(approach[2]) / GENERATOR.CHUNK_SIZE))
	var descriptor := generator.chunk_descriptor(chunk.x, chunk.y)
	var megastructure: Dictionary = descriptor.get("megastructure", {})
	var lod: Dictionary = descriptor.get("megastructure_lod", {})
	_expect(str(lod.get("schema", "")) == LOD.SCHEMA and lod == LOD.compile(megastructure), "chunk lod descriptor drifted")
	_expect(not (lod.get("macro_silhouettes", []) as Array).is_empty() and not (lod.get("sector_shells", []) as Array).is_empty() and not (lod.get("active_collisions", []) as Array).is_empty() and not (lod.get("traversal_details", []) as Array).is_empty(), "chunk lod phases missing")
	var history_reveal: Dictionary = (source.get("reveals", []) as Array)[1]
	var history_anchor: Array = history_reveal.get("recommended_view_anchor", [])
	var history_chunk := Vector2i(floori(float(history_anchor[0]) / GENERATOR.CHUNK_SIZE), floori(float(history_anchor[2]) / GENERATOR.CHUNK_SIZE))
	var history_lod: Dictionary = generator.chunk_descriptor(history_chunk.x, history_chunk.y).get("megastructure_lod", {})
	_expect((history_lod.get("historical_layers", []) as Array).size() >= 5, "history-view chunk lost its epoch layers")
	var collision: Dictionary = (lod.get("active_collisions", []) as Array)[0]
	_expect(int(collision.get("floor_y", 0)) == 24 and int(collision.get("ceiling_y", 0)) == 100 and not (collision.get("bounds", {}) as Dictionary).is_empty(), "enclosed shell contract drifted")
	var parsed: Variant = JSON.parse_string(JSON.stringify(lod))
	_expect(parsed is Dictionary, "chunk lod descriptor is not JSON serializable")
	(lod.get("macro_silhouettes", []) as Array)[0]["id"] = "mutated"
	_expect(str((generator.chunk_descriptor(chunk.x, chunk.y).get("megastructure_lod", {}) as Dictionary).get("macro_silhouettes", [])[0].get("id", "")) != "mutated", "chunk lod descriptor leaked mutable state")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
