extends SceneTree
const GENERATOR=preload("res://scripts/world_generator.gd")
const FIXTURE_PATH="res://levels/urban-region-fixtures.v1.json"
const EPSILON:=.000001
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var file:=FileAccess.open(FIXTURE_PATH,FileAccess.READ);_expect(file!=null,"urban fixtures missing")
	if file==null:quit(1);return
	var document:Variant=JSON.parse_string(file.get_as_text());_expect(document is Dictionary,"urban fixtures invalid")
	if not document is Dictionary:quit(1);return
	var fixtures:Dictionary=document;_expect(str(fixtures.get("schema",""))=="urban-region-fixtures/v1","urban fixture schema drifted")
	for fixture:Dictionary in fixtures.get("cases",[]):
		var chunk:Dictionary=fixture.get("chunk",{});var descriptor:=GENERATOR.new(int(fixture.seed)).chunk_descriptor(int(chunk.x),int(chunk.z));var expected_urban:Dictionary=fixture.urban;_expect(str(descriptor.region.family)==str(fixture.family) and str(descriptor.urban.land_use)==str(expected_urban.land_use) and int(descriptor.urban.ruin_age_years)==int(expected_urban.ruin_age_years),"urban fixture family or fields drifted: "+str(fixture.id));_expect(descriptor==GENERATOR.new(int(fixture.seed)).chunk_descriptor(int(chunk.x),int(chunk.z)),"urban descriptor lost determinism: "+str(fixture.id))
		for key:String in fixture.get("required_fields",[]):_expect(descriptor.has(key),"urban fixture field missing: "+str(fixture.id)+"/"+key)
		_assert_signature(descriptor,fixture)
	quit(1 if failed else 0)
func _assert_signature(descriptor:Dictionary,fixture:Dictionary)->void:
	var signature:Dictionary=fixture.signature;var family:=str(fixture.family)
	if family=="reclaimed_city":_expect(str(descriptor.city_layout.layout)==str(signature.layout) and str(descriptor.city_layout.spine_axis)==str(signature.axis) and (descriptor.city_buildings.buildings as Array).size()==int(signature.building_count),"reclaimed fixture signature drifted")
	elif family=="flooded_city":_expect(str(descriptor.flood_basin.placement)==str(signature.placement) and str(descriptor.flood_basin.shore_axis)==str(signature.shore_axis) and int(descriptor.flood_basin.water_neighbors)==int(signature.water_neighbors) and absf(float(descriptor.flood_inundation.inundation_depth)-float(signature.inundation_depth))<=EPSILON,"flooded fixture signature drifted")
	elif family=="industrial_ruin":_expect(str(descriptor.industrial_layout.zone)==str(signature.zone) and str(descriptor.industrial_layout.service_axis)==str(signature.axis) and (descriptor.industrial_structures.factories as Array).size()==int(signature.factory_count),"industrial fixture signature drifted")
	elif family=="overgrown_suburb":_expect(str(descriptor.suburb_roads.collector.axis)==str(signature.collector_axis) and absf(float(descriptor.suburb_roads.collector.offset)-float(signature.collector_offset))<=EPSILON and (descriptor.suburb_parcels.homes as Array).size()==int(signature.home_count),"suburb fixture signature drifted")
