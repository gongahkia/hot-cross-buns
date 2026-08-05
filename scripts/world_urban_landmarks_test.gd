extends SceneTree
const TAXONOMY=preload("res://scripts/world_urban_landmarks.gd")
const LANDMARKS=preload("res://scripts/world_landmarks.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	for family in ["reclaimed_city","flooded_city","industrial_ruin","overgrown_suburb"]:
		var region:Dictionary={"id":"2:-3","x":2,"z":-3,"family":family,"landmark":"radio mast"};var result:=TAXONOMY.describe(20260730,region);_expect(str(result.urban_landmark_id)=="urban_landmark:2:-3" and not str(result.taxonomy).is_empty() and str(result.name).ends_with("Radio Mast") and str(result.family)==family,"urban landmark taxonomy drifted")
	_expect(TAXONOMY.describe(1,{"family":"wilderness","landmark":"radio mast"}).is_empty() and TAXONOMY.describe(1,{"family":"industrial_ruin"}).is_empty(),"urban landmark eligibility drifted")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var region:=generator.region_at(Vector3(float(region_x)*512.0,0.0,float(region_z)*512.0));var detail:=TAXONOMY.describe(20260730,region)
			if detail.is_empty():continue
			found=true;var record:=LANDMARKS.new().record_for(20260730,region);_expect(str(record.taxonomy)==str(detail.taxonomy) and str(record.name)==str(detail.name) and str(record.urban_landmark_id)==str(detail.urban_landmark_id),"urban landmark record wiring drifted");break
		if found:break
	_expect(found,"urban landmark fixture found no named urban landmark")
	quit(1 if failed else 0)
