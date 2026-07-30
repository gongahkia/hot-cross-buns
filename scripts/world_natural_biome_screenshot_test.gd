extends SceneTree

const SCREENSHOT = preload("res://scripts/world_natural_biome_screenshot.gd")
const FIXTURE_PATH := "res://levels/natural-biome-screenshot-goldens.v1.json"
var failed := false

func _initialize() -> void:
	var file := FileAccess.open(FIXTURE_PATH,FileAccess.READ)
	_expect(file != null,"natural biome screenshot goldens missing")
	if file == null:
		quit(1)
		return
	var document: Variant = JSON.parse_string(file.get_as_text())
	_expect(document is Dictionary,"natural biome screenshot goldens invalid")
	if not document is Dictionary:
		quit(1)
		return
	var fixture: Dictionary = document
	_expect(str(fixture.get("schema","")) == "natural-biome-screenshot-goldens/v1","natural biome screenshot schema changed")
	for value in fixture.get("cases",[]):
		_expect(value is Dictionary,"natural biome screenshot case malformed")
		if not value is Dictionary: continue
		_assert_case(value as Dictionary)
	quit(1 if failed else 0)

func _assert_case(fixture: Dictionary) -> void:
	var cells: Array = fixture.get("cells",[])
	var capture := SCREENSHOT.capture(cells,int(fixture.get("columns",0)),int(fixture.get("tile_size",0)))
	var repeat := SCREENSHOT.capture(cells,int(fixture.get("columns",0)),int(fixture.get("tile_size",0)))
	_expect(capture.biomes == repeat.biomes and str(capture.rgba_sha256) == str(repeat.rgba_sha256) and (capture.image as Image).get_data() == (repeat.image as Image).get_data(),"natural biome screenshot lost repeatability: " + str(fixture.get("id","")))
	_expect(int(capture.width) == int(fixture.get("width",0)) and int(capture.height) == int(fixture.get("height",0)),"natural biome screenshot dimensions drifted: " + str(fixture.get("id","")))
	_expect(capture.biomes == fixture.get("biomes",[]),"natural biome screenshot biome labels drifted: " + str(fixture.get("id","")) + " expected " + str(fixture.get("biomes",[])) + " actual " + str(capture.biomes))
	_expect(str(capture.rgba_sha256) == str(fixture.get("rgba_sha256","")),"natural biome screenshot rgba golden drifted: " + str(fixture.get("id","")) + " expected " + str(fixture.get("rgba_sha256","")) + " actual " + str(capture.rgba_sha256))
	var image: Image = capture.image
	_expect(image.get_format() == Image.FORMAT_RGBA8 and image.get_data().size() == int(capture.width) * int(capture.height) * 4,"natural biome screenshot format drifted: " + str(fixture.get("id","")))

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
