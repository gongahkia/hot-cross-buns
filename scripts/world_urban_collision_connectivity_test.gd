extends SceneTree
const FIXTURE_PATH="res://levels/urban-region-fixtures.v1.json"
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var scene:=load("res://scenes/main.tscn") as PackedScene;var main:=scene.instantiate();get_root().add_child(main);await process_frame;main.start_level("expedition");await process_frame
	var file:=FileAccess.open(FIXTURE_PATH,FileAccess.READ);_expect(file!=null,"urban fixtures missing")
	if file==null:quit(1);return
	var fixtures:Dictionary=JSON.parse_string(file.get_as_text())
	for fixture:Dictionary in fixtures.get("cases",[]):
		var chunk:Dictionary=fixture.chunk;var streamer=main.world_streamer;var descriptor:Dictionary=streamer.generator.chunk_descriptor(int(chunk.x),int(chunk.z));var urban_chunk:Node3D=streamer._build_chunk(int(chunk.x),int(chunk.z));_assert_collisions(urban_chunk,str(fixture.family));_assert_connectivity(descriptor,str(fixture.family));urban_chunk.queue_free()
	await process_frame;main.queue_free();await process_frame;quit(1 if failed else 0)
func _assert_collisions(chunk:Node3D,family:String)->void:
	var names:Array=[]
	if family=="reclaimed_city":names=["Building"]
	elif family=="flooded_city":names=["FloodStructure","FloodBridge","FloodRoofRoute"]
	elif family=="industrial_ruin":names=["IndustrialFactory","IndustrialTank","IndustrialCatwalk","IndustrialAccessStep"]
	elif family=="overgrown_suburb":names=["SuburbHomeWall","SuburbHomeRoof","SuburbPorch"]
	for node_name:String in names:
		var nodes:=chunk.find_children(node_name+"*","StaticBody3D",true,false);_expect(not nodes.is_empty(),"urban collision missing: "+family+"/"+node_name)
		for node:StaticBody3D in nodes:_expect(not node.find_children("*","CollisionShape3D",true,false).is_empty(),"urban collider missing shape: "+family+"/"+node_name)
func _assert_connectivity(descriptor:Dictionary,family:String)->void:
	if family=="reclaimed_city":_expect((descriptor.city_buildings.buildings as Array).size()>0 and (descriptor.city_traversal.facades as Array).size()==(descriptor.city_buildings.buildings as Array).size(),"reclaimed traversal connectivity missing")
	elif family=="flooded_city":_expect(not (descriptor.flood_routes.bridges as Array).is_empty() and not (descriptor.flood_routes.roof_routes as Array).is_empty(),"flooded route connectivity missing")
	elif family=="industrial_ruin":_expect(not (descriptor.industrial_traversal.catwalks as Array).is_empty() and not (descriptor.industrial_traversal.access_routes as Array).is_empty(),"industrial route connectivity missing")
	elif family=="overgrown_suburb":_expect((descriptor.suburb_transitions.entries as Array).size()==(descriptor.suburb_transitions.interiors as Array).size() and not (descriptor.suburb_traversal.roots as Array).is_empty(),"suburb transition connectivity missing")
