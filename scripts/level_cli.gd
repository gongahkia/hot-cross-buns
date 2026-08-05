extends SceneTree

const LEVEL_DOCUMENT := preload("res://scripts/level_document.gd")

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var path := "res://levels/sandbox.level.json"
	var validate := args.has("--level-validate")
	var publish := args.has("--level-publish")
	if args.has("--validation-fixtures"):
		_run_validation_fixtures()
		return
	for index in range(args.size() - 1):
		if args[index] in ["--level-validate", "--level-publish"]:
			path = str(args[index + 1])
	var document: Variant = LEVEL_DOCUMENT.load_from_path(path)
	if publish:
		var published: Dictionary = document.publish()
		print(JSON.stringify(published))
		quit(0 if bool(published.get("ok", false)) else 1)
		return
	if validate:
		var report: Dictionary = document.validation_report()
		print(JSON.stringify(report))
		quit(0 if (report.get("errors", []) as Array).is_empty() else 1)
		return
	print("usage: --level-validate <res://level.json> | --level-publish <res://level.json> | --validation-fixtures")
	quit(2)

func _run_validation_fixtures() -> void:
	var file := FileAccess.open("res://levels/validation-fixtures.v1.json", FileAccess.READ)
	if file == null:
		print("validation fixtures missing")
		quit(1)
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		print("validation fixtures invalid")
		quit(1)
		return
	for fixture in parsed.get("cases", []):
		if not fixture is Dictionary:
			print("validation fixture malformed")
			quit(1)
			return
		var document_data: Variant = fixture.get("document", {})
		if not document_data is Dictionary:
			print("validation fixture document malformed")
			quit(1)
			return
		var document: Variant = LEVEL_DOCUMENT.from_data(document_data)
		var report: Dictionary = document.validation_report()
		if not _same_codes(report.get("error_codes", []), fixture.get("error_codes", [])) or not _same_codes(report.get("warning_codes", []), fixture.get("warning_codes", [])):
			print(JSON.stringify({"fixture": fixture.get("id", "unnamed"), "actual": report, "expected": {"error_codes": fixture.get("error_codes", []), "warning_codes": fixture.get("warning_codes", [])}}))
			quit(1)
			return
	print("validation fixtures ok")
	quit(0)

func _same_codes(actual: Variant, expected: Variant) -> bool:
	if not actual is Array or not expected is Array:
		return false
	return actual == expected
