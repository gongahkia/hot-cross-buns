extends SceneTree
const JOURNAL = preload("res://scripts/world_survey_journal.gd")
var failed := false
func _initialize() -> void:
	var journal := JOURNAL.new()
	_expect(journal.survey_region({"id":"1:2","name":"Floodplain","family":"wilderness"}), "region was not recorded")
	_expect(not journal.survey_region({"id":"1:2","name":"Changed"}), "duplicate region was recorded")
	_expect(journal.survey_landmark({"id":"landmark:1:2","kind":"radio mast","taxonomy":"communications"}), "landmark was not recorded")
	_expect(not journal.survey_landmark({"id":"landmark:1:2","kind":"changed"}), "duplicate landmark was recorded")
	var snapshot: Dictionary = journal.snapshot()
	_expect(snapshot.regions == [{"id":"1:2","name":"Floodplain","family":"wilderness"}] and snapshot.landmarks == [{"id":"landmark:1:2","name":"radio mast","kind":"radio mast","taxonomy":"communications"}], "journal snapshot drifted")
	(snapshot.regions as Array)[0]["name"] = "Changed"
	_expect(str((journal.snapshot().regions as Array)[0].name) == "Floodplain", "journal leaked mutable records")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
