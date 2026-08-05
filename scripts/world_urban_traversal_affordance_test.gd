extends SceneTree
const FIXTURE_PATH="res://levels/urban-region-fixtures.v1.json"
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var file:=FileAccess.open(FIXTURE_PATH,FileAccess.READ);_expect(file!=null,"urban fixtures missing")
	if file==null:quit(1);return
	var fixtures:Dictionary=JSON.parse_string(file.get_as_text())
	for fixture:Dictionary in fixtures.get("cases",[]):
		var chunk:Dictionary=fixture.chunk;var descriptor:=GENERATOR.new(int(fixture.seed)).chunk_descriptor(int(chunk.x),int(chunk.z));_assert_affordances(descriptor,str(fixture.family))
	quit(1 if failed else 0)
func _assert_affordances(descriptor:Dictionary,family:String)->void:
	if family=="reclaimed_city":
		var buildings:Dictionary={};var failures:Dictionary={}
		for building:Dictionary in descriptor.city_buildings.buildings:buildings[str(building.id)]=building
		for failure:Dictionary in descriptor.city_failures.failures:failures[str(failure.building_id)]=failure
		var surviving:=0
		for facade:Dictionary in descriptor.city_traversal.facades:
			var building:Dictionary=buildings.get(str(facade.building_id),{});var failure:Dictionary=failures.get(str(facade.building_id),{});if not building.is_empty() and float(facade.ledge_height)<float(building.height)*float(failure.height_scale)-.75:surviving+=1
		_expect(surviving>0 and not (descriptor.city_traversal.roofs as Array).is_empty(),"reclaimed facade/roof affordance missing")
	elif family=="flooded_city":
		for bridge:Dictionary in descriptor.flood_routes.bridges:_expect(float(bridge.height)>=float(descriptor.flood_inundation.inundation_depth)+1.5 and float(bridge.length)>float((descriptor.flood_routes.canals as Array)[0].width),"flooded bridge affordance drifted")
		for roof:Dictionary in descriptor.flood_routes.roof_routes:_expect(float(roof.height)>=7.0 and float(roof.length)>0.0,"flooded roof affordance drifted")
	elif family=="industrial_ruin":
		for catwalk:Dictionary in descriptor.industrial_traversal.catwalks:_expect(float(catwalk.width)>=1.8 and float(catwalk.length)>0.0 and float(catwalk.height)>0.0,"industrial catwalk affordance drifted")
		for access:Dictionary in descriptor.industrial_traversal.access_routes:_expect(int(access.step_count)>=2 and float(access.rise)>0.0 and float(access.run)>0.0,"industrial access affordance drifted")
	elif family=="overgrown_suburb":
		for entry:Dictionary in descriptor.suburb_transitions.entries:_expect(float(entry.width)>=1.6 and float(entry.porch_depth)>0.0,"suburb entry affordance drifted")
		for canopy:Dictionary in descriptor.suburb_traversal.canopies:_expect(float(canopy.trunk_height)>=6.0 and float(canopy.platform_width)>=3.2,"suburb canopy affordance drifted")
		_expect(not (descriptor.suburb_traversal.roots as Array).is_empty() and not (descriptor.suburb_traversal.collapses as Array).is_empty(),"suburb root/collapse affordance missing")
