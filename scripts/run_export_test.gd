extends SceneTree
const EXPORT = preload("res://scripts/run_export.gd")
var failed := false
func _initialize() -> void:
	var seed := EXPORT.seed_payload(20260730)
	_expect(seed == {"schema":"a-slow-walk.export.v1","type":"seed","world":{"seed":"20260730","generator_schema_version":"1.0.0","generation_options":{}}}, "seed export payload drifted")
	var card := EXPORT.run_card_payload({"id":2,"outcome":"extracted","level":"expedition","seed":7,"elapsed":12.5,"collectibles":3,"resources":{"wood":2},"regions":["1:2"],"survival":{"health":80.0}})
	_expect(card.world.seed == "7" and int(card.run.id) == 2 and int(card.run.resources.wood) == 2, "run-card export payload drifted")
	var photo := EXPORT.photo_payload("user://captures/p.png", "user://captures/p.json", {"run":{"seed":8},"capture":{"width":1920}})
	_expect(photo.world.seed == "8" and photo.photo.image == "p.png" and photo.photo.metadata == "p.json", "photo export payload drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
