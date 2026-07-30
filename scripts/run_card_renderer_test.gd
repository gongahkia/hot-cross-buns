extends SceneTree
const RENDERER = preload("res://scripts/run_card_renderer.gd")
var failed := false
func _initialize() -> void:
	var card := RENDERER.render({"world":{"seed":"7","generator_schema_version":"1.0.0"},"run":{"id":2,"outcome":"extracted","level":"<expedition>","elapsed":125.0,"collectibles":3,"resources":{"wood":2,"food":1},"regions":["1:2"]}})
	_expect(card.begins_with("<svg") and card.contains("EXTRACTED") and card.contains("SEED 7") and card.contains("02:05"), "run-card composition drifted")
	_expect(card.contains("&lt;EXPEDITION&gt;") and card.find("FOOD 1 / WOOD 2") >= 0, "run-card escaping or ordering drifted")
	_expect(RENDERER.render({"world":{},"run":{}}) == RENDERER.render({"world":{},"run":{}}), "run-card renderer is not deterministic")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
