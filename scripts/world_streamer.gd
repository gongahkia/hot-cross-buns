class_name WorldStreamer
extends Node3D

signal region_changed(region: Dictionary)
signal chunk_stats_changed(stats: Dictionary)
signal streaming_hitch(sample:Dictionary)

const GENERATOR := preload("res://scripts/world_generator.gd")
const RNG := preload("res://scripts/world_rng.gd")
const RESOURCE_PICKUP := preload("res://scripts/resource_pickup.gd")
const WORLD_ORIGIN := preload("res://scripts/world_origin.gd")
const CHUNK_SCHEDULER := preload("res://scripts/world_chunk_scheduler.gd")
const CHUNK_CACHE := preload("res://scripts/world_chunk_cache.gd")
const RENDER_LOD := preload("res://scripts/world_render_lod.gd")
const COLLISION_LOD := preload("res://scripts/world_collision_lod.gd")
const COLLISION_MESH := preload("res://scripts/world_collision_mesh.gd")
const COLLISION_HANDOFF := preload("res://scripts/world_collision_handoff.gd")
const FAR_TERRAIN := preload("res://scripts/world_far_terrain.gd")
const PRELOAD_CORRIDOR := preload("res://scripts/world_preload_corridor.gd")
const LANDMARKS := preload("res://scripts/world_landmarks.gd")
const RESOURCE_PLACEMENT := preload("res://scripts/world_resource_placement.gd")
const HAZARD_PLACEMENT := preload("res://scripts/world_hazard_placement.gd")
const STREAMING_TELEMETRY := preload("res://scripts/world_streaming_telemetry.gd")
const CHUNK_MEMORY_TELEMETRY := preload("res://scripts/world_chunk_memory_telemetry.gd")

const GRID := 16
const ACTIVE_RADIUS := 2

var generator
var player: SpeedPlayer
var chunks: Dictionary = {}
var current_center := Vector2i(2147483647, 2147483647)
var current_region_id := ""
var origin
var scheduler
var pending_chunks: Dictionary = {}
var chunk_cache
var far_chunks: Dictionary = {}
var active_ids: Dictionary = {}
var landmarks=LANDMARKS.new()
var streaming_telemetry=STREAMING_TELEMETRY.new()

func configure(next_seed: int, next_player: SpeedPlayer) -> void:
	generator = GENERATOR.new(next_seed)
	origin = WORLD_ORIGIN.new(GENERATOR.CHUNK_SIZE)
	scheduler = CHUNK_SCHEDULER.new(next_seed)
	chunk_cache = CHUNK_CACHE.new(128)
	player = next_player
	name = "ExpeditionWorld"
	refresh(true)

func _process(_delta: float) -> void:
	var started:=Time.get_ticks_usec()
	refresh(false)
	var hitch:=streaming_telemetry.record_refresh(float(Time.get_ticks_usec()-started)/1000.0,_streaming_context())
	if not hitch.is_empty():streaming_hitch.emit(hitch)

func _exit_tree() -> void:
	if scheduler: scheduler.shutdown()

func refresh(force: bool) -> void:
	if generator == null or player == null: return
	_attach_completed(scheduler.wait_for_all() if force else scheduler.poll())
	var rebase: Vector3 = origin.rebase_delta(player.global_position)
	if rebase != Vector3.ZERO:
		player.global_position += rebase
		for root: Node3D in chunks.values(): root.global_position += rebase
		for root: Node3D in far_chunks.values(): root.global_position += rebase
	var center: Vector2i = origin.chunk_at_local(player.global_position)
	if not force and center == current_center:
		_update_region()
		return
	current_center = center
	var wanted: Dictionary = {}
	for z in range(center.y - ACTIVE_RADIUS, center.y + ACTIVE_RADIUS + 1):
		for x in range(center.x - ACTIVE_RADIUS, center.x + ACTIVE_RADIUS + 1):
			var id := _chunk_id(x, z)
			wanted[id] = true
			if not chunks.has(id) and not pending_chunks.has(id):
				if chunk_cache and not chunk_cache.fetch(id).is_empty():
					_remove_far_chunk(id)
					chunks[id]=_build_chunk(x,z)
				else: pending_chunks[id] = scheduler.request(x, z, 0, _chunk_priority(center, Vector2i(x, z)))
	active_ids=wanted.duplicate()
	if force:
		_attach_completed(scheduler.wait_for_all())
	var preload_targets:=PRELOAD_CORRIDOR.targets(center,_preload_heading())
	for id in preload_targets.keys():
		if chunks.has(id) or pending_chunks.has(id) or (chunk_cache and not chunk_cache.fetch(id).is_empty()):continue
		var chunk:Vector2i=preload_targets[id];pending_chunks[id]=scheduler.request(chunk.x,chunk.y,0,50.0)
		wanted[id]=true
	for id in pending_chunks.keys():
		if not wanted.has(id): scheduler.cancel(int(pending_chunks[id]));pending_chunks.erase(id)
	for id in chunks.keys():
		if not active_ids.has(id):
			var stale: Node = chunks[id]
			chunks.erase(id)
			stale.queue_free()
	_update_collision_lods()
	_update_far_terrain()
	_update_region()
	chunk_stats_changed.emit({"active": chunks.size(), "center": [center.x, center.y],"memory":chunk_memory_snapshot()})

func _attach_completed(results: Array) -> void:
	for result: Dictionary in results:
		var key: Dictionary = result.get("key", {})
		var id := _chunk_id(int(key.get("chunk_x", 0)), int(key.get("chunk_z", 0)))
		if int(pending_chunks.get(id,-1)) != int(result.get("token",-2)): continue
		pending_chunks.erase(id)
		if str(result.get("status", "")) == "ok" and not chunks.has(id):
			chunk_cache.put(id,result.get("descriptor",{}))
			if active_ids.has(id):
				_remove_far_chunk(id)
				chunks[id] = _build_chunk(int(key.get("chunk_x", 0)), int(key.get("chunk_z", 0)))

func _remove_far_chunk(id:String)->void:
	if not far_chunks.has(id):return
	var far:Node=far_chunks[id]
	far_chunks.erase(id)
	far.queue_free()

func _streaming_context()->Dictionary:
	var memory:=chunk_memory_snapshot()
	return {"active":chunks.size(),"pending":pending_chunks.size(),"cached":chunk_cache.size() if chunk_cache else 0,"far":far_chunks.size(),"minimum_payload_bytes":memory.minimum_payload_bytes,"static_memory_bytes":memory.static_memory_bytes}

func chunk_memory_snapshot()->Dictionary:
	var render_grids:Array=[];var collision_grids:Array=[]
	for root:Node3D in chunks.values():
		render_grids.append(int(root.get_meta("render_grid",GRID)))
		collision_grids.append(int(root.get_meta("collision_grid",GRID)))
	return CHUNK_MEMORY_TELEMETRY.snapshot(render_grids,collision_grids,far_chunks.size(),chunk_cache.size() if chunk_cache else 0,int(Performance.get_monitor(Performance.MEMORY_STATIC)))

func _preload_heading()->Vector2:
	var velocity:=Vector2(player.velocity.x,player.velocity.z)
	if velocity.length_squared()>.25:return velocity.normalized()
	if player.camera:
		var facing:=-Vector2(player.camera.global_transform.basis.z.x,player.camera.global_transform.basis.z.z)
		if facing.length_squared()>0.0001:return facing.normalized()
	return Vector2.ZERO

func _chunk_priority(center: Vector2i, target: Vector2i) -> float:
	var offset:=Vector2(float(target.x-center.x),float(target.y-center.y));var velocity:=Vector2(player.velocity.x,player.velocity.z);var forward:=Vector2(player.camera.global_transform.basis.z.x,player.camera.global_transform.basis.z.z) if player.camera else Vector2.ZERO
	return offset.length_squared()-offset.normalized().dot(velocity.normalized())*.8-offset.normalized().dot(-forward.normalized())*.45 if not is_zero_approx(offset.length_squared()) else -1.0

func sample_at(world_position: Vector3) -> Dictionary:
	var canonical: Vector3 = origin.world_position(world_position) if origin else world_position
	return generator.sample(canonical.x, canonical.z) if generator else {}

func ground_height(world_position: Vector3) -> float:
	return float(sample_at(world_position).get("elevation", 0.0))

func _update_region() -> void:
	var region: Dictionary = generator.region_at(origin.world_position(player.global_position))
	if str(region.id) == current_region_id: return
	current_region_id = str(region.id)
	region_changed.emit(region)

func _build_chunk(chunk_x: int, chunk_z: int) -> Node3D:
	var descriptor: Dictionary = chunk_cache.fetch(_chunk_id(chunk_x,chunk_z)) if chunk_cache else {}
	if descriptor.is_empty(): descriptor=generator.chunk_descriptor(chunk_x, chunk_z)
	var root := Node3D.new()
	root.name = "Chunk_%d_%d" % [chunk_x, chunk_z]
	root.position = origin.local_chunk_position(Vector2i(chunk_x, chunk_z))
	root.set_meta("descriptor", descriptor)
	root.set_meta("chunk_x",chunk_x)
	root.set_meta("chunk_z",chunk_z)
	add_child(root)
	var distance:=Vector2(float(chunk_x-current_center.x),float(chunk_z-current_center.y)).length();var render_grid:=RENDER_LOD.grid_for_distance(distance);var collision_grid:=COLLISION_LOD.grid_for_distance(distance)
	root.set_meta("render_grid",render_grid)
	root.set_meta("collision_grid",collision_grid)
	var mesh := _terrain_mesh(chunk_x, chunk_z, str(descriptor.biome), str(descriptor.region.family),render_grid)
	var terrain := StaticBody3D.new()
	terrain.name = "Terrain"
	var visual := MeshInstance3D.new()
	visual.mesh = mesh
	visual.material_override = _terrain_material(str(descriptor.biome), str(descriptor.region.family))
	terrain.add_child(visual)
	terrain.add_child(_collision_shape(chunk_x,chunk_z,collision_grid))
	root.add_child(terrain)
	_add_features(root, chunk_x, chunk_z, descriptor)
	return root

func _update_collision_lods()->void:
	for root:Node3D in chunks.values():
		var chunk_x:=int(root.get_meta("chunk_x",0));var chunk_z:=int(root.get_meta("chunk_z",0));var distance:=Vector2(float(chunk_x-current_center.x),float(chunk_z-current_center.y)).length();var grid:=COLLISION_LOD.grid_for_distance(distance)
		if int(root.get_meta("collision_grid",GRID))==grid:continue
		var terrain:=root.get_node_or_null("Terrain") as StaticBody3D
		if not terrain:continue
		var retiring:=COLLISION_HANDOFF.install(terrain,_collision_shape(chunk_x,chunk_z,grid))
		root.set_meta("collision_grid",grid)
		if retiring:COLLISION_HANDOFF.retire_after_physics_frame(get_tree(),retiring)

func _collision_shape(chunk_x:int,chunk_z:int,grid:int)->CollisionShape3D:
	var collision:=CollisionShape3D.new();collision.shape=COLLISION_MESH.heightmap(generator,GENERATOR.CHUNK_SIZE,chunk_x,chunk_z,grid)
	var step:=GENERATOR.CHUNK_SIZE/float(grid);collision.position=Vector3(GENERATOR.CHUNK_SIZE*.5,0.0,GENERATOR.CHUNK_SIZE*.5);collision.scale=Vector3(step,step,step)
	return collision

func _update_far_terrain()->void:
	var wanted:=FAR_TERRAIN.targets(current_center,ACTIVE_RADIUS)
	for id in far_chunks.keys():
		if not wanted.has(id) or chunks.has(id) or (active_ids.has(id) and pending_chunks.has(id)):
			var stale:Node=far_chunks[id]
			far_chunks.erase(id)
			stale.queue_free()
	for id in wanted.keys():
		if chunks.has(id) or (active_ids.has(id) and pending_chunks.has(id)) or far_chunks.has(id):continue
		var chunk:Vector2i=wanted[id];far_chunks[id]=_build_far_chunk(chunk.x,chunk.y)

func _build_far_chunk(chunk_x:int,chunk_z:int)->Node3D:
	var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z);var root:=Node3D.new()
	root.name="FarChunk_%d_%d"%[chunk_x,chunk_z];root.position=origin.local_chunk_position(Vector2i(chunk_x,chunk_z));root.set_meta("impostor",true);root.set_meta("render_grid",FAR_TERRAIN.GRID)
	var visual:=MeshInstance3D.new();visual.mesh=_terrain_mesh(chunk_x,chunk_z,str(descriptor.biome),str(descriptor.region.family),FAR_TERRAIN.GRID);visual.material_override=_terrain_material(str(descriptor.biome),str(descriptor.region.family))
	root.add_child(visual);add_child(root)
	return root

func _terrain_mesh(chunk_x: int, chunk_z: int, biome: String, family: String, grid: int = GRID) -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var step := GENERATOR.CHUNK_SIZE / float(grid)
	for z in range(grid):
		for x in range(grid):
			var a := _vertex(chunk_x, chunk_z, x, z, step)
			var b := _vertex(chunk_x, chunk_z, x + 1, z, step)
			var c := _vertex(chunk_x, chunk_z, x + 1, z + 1, step)
			var d := _vertex(chunk_x, chunk_z, x, z + 1, step)
			for vertex in [a, b, c, a, c, d]:
				surface.set_uv(Vector2(vertex.x / GENERATOR.CHUNK_SIZE, vertex.z / GENERATOR.CHUNK_SIZE))
				surface.add_vertex(vertex)
	var mesh := surface.commit()
	mesh.resource_name = biome + "_" + family
	return mesh

func _vertex(chunk_x: int, chunk_z: int, x: int, z: int, step: float) -> Vector3:
	var local_x := float(x) * step
	var local_z := float(z) * step
	var sample: Dictionary = generator.sample(float(chunk_x) * GENERATOR.CHUNK_SIZE + local_x, float(chunk_z) * GENERATOR.CHUNK_SIZE + local_z)
	return Vector3(local_x, float(sample.elevation), local_z)

func _add_features(root: Node3D, chunk_x: int, chunk_z: int, descriptor: Dictionary) -> void:
	var family := str(descriptor.region.family)
	var seed: int = generator.seed
	var landmark:=landmarks.for_chunk(seed,descriptor.region,chunk_x,chunk_z)
	if not landmark.is_empty():_add_landmark(root,landmark)
	if family == "reclaimed_city":
		_add_city_arterials(root,descriptor.get("city_arterials",{}))
		_add_city_secondary_roads(root,descriptor.get("city_secondary_roads",{}))
		_add_city_buildings(root,descriptor.get("city_buildings",{}))
	elif family == "flooded_city":
		_add_city_blocks(root, chunk_x, chunk_z, 4, Color("#39545a"), Color("#79a99b"), true)
	elif family == "industrial_ruin":
		_add_industrial(root, chunk_x, chunk_z)
	elif family == "overgrown_suburb":
		_add_suburb(root, chunk_x, chunk_z)
	else:
		_add_wilderness(root, chunk_x, chunk_z, str(descriptor.biome))
	var resource:=RESOURCE_PLACEMENT.for_chunk(seed,chunk_x,chunk_z,family)
	if not resource.is_empty():_add_resource(root,resource)
	var hazard:=HAZARD_PLACEMENT.for_chunk(seed,chunk_x,chunk_z,str(descriptor.biome),family)
	if not hazard.is_empty():_add_hazard(root,hazard)
	if RNG.unit(seed, chunk_x, chunk_z, 419) > 0.82:
		_add_grapple_anchor(root, chunk_x, chunk_z)

func _add_landmark(root:Node3D,record:Dictionary)->void:
	var landmark:=Node3D.new();landmark.name="Landmark_"+str(record.id).replace(":","_");landmark.set_meta("record",record.duplicate(true))
	var position:=Vector3(float(record.local_x),ground_height(root.global_position+Vector3(float(record.local_x),0.0,float(record.local_z))),float(record.local_z));landmark.position=position
	var size:=Vector3(4.0,8.0,4.0);var color:=Color("#8e9a8d")
	if str(record.kind)=="radio mast":size=Vector3(1.2,18.0,1.2);color=Color("#9db7a0")
	elif str(record.kind)=="collapsed observatory":size=Vector3(10.0,4.0,10.0);color=Color("#8b897d")
	elif str(record.kind)=="floodgate":size=Vector3(14.0,7.0,2.0);color=Color("#6d8280")
	elif str(record.kind)=="wind farm":size=Vector3(2.0,14.0,2.0);color=Color("#d4ded5")
	elif str(record.kind)=="glass conservatory":size=Vector3(9.0,6.0,7.0);color=Color("#91b8a1")
	_add_box(landmark,Vector3(0.0,size.y*.5,0.0),size,color,"LandmarkCore")
	root.add_child(landmark)

func _add_city_blocks(root: Node3D, chunk_x: int, chunk_z: int, count: int, color: Color, growth: Color, flooded := false) -> void:
	for index in range(count):
		var x := 6.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 151 + index) * 52.0
		var z := 6.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 173 + index) * 52.0
		var height := 5.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 191 + index) * 25.0
		if flooded: height *= 0.62
		var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
		_add_box(root, Vector3(x, ground + height * 0.5, z), Vector3(6.0 + fmod(float(index), 3.0) * 2.0, height, 7.0), color, "Ruin")
		if index % 2 == 0:
			_add_box(root, Vector3(x, ground + height + 1.2, z), Vector3(1.2, 2.4, 1.2), growth, "Regrowth")

func _add_city_arterials(root:Node3D,arterials:Dictionary)->void:
	for road:Dictionary in arterials.get("arterials",[]):
		var axis:=str(road.get("axis","x"));var offset:=float(road.get("offset",32.0));var width:=float(road.get("width",4.0));var position:=Vector3(32.0,0.04,offset) if axis=="x" else Vector3(offset,0.04,32.0)
		position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(64.0,.08,width) if axis=="x" else Vector3(width,.08,64.0);visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#3d4544"));root.add_child(visual)

func _add_city_secondary_roads(root:Node3D,roads:Dictionary)->void:
	for road:Dictionary in roads.get("roads",[]):
		var axis:=str(road.get("axis","x"));var offset:=float(road.get("offset",32.0));var width:=float(road.get("width",1.0));var position:=Vector3(32.0,0.03,offset) if axis=="x" else Vector3(offset,0.03,32.0)
		position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(64.0,.06,width) if axis=="x" else Vector3(width,.06,64.0);visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#59605b") if str(road.get("kind",""))=="secondary" else Color("#4a504c"));root.add_child(visual)

func _add_city_buildings(root:Node3D,massing:Dictionary)->void:
	for building:Dictionary in massing.get("buildings",[]):
		var x:=float(building.get("x",32.0));var z:=float(building.get("z",32.0));var height:=float(building.get("height",6.0));var color:=Color("#4f6355") if str(building.get("form",""))=="courtyard" else Color("#495852")
		_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),Vector3(float(building.get("width",4.0)),height,float(building.get("depth",4.0))),color,"Building")

func _add_industrial(root: Node3D, chunk_x: int, chunk_z: int) -> void:
	for index in range(4):
		var x := 9.0 + float(index % 2) * 30.0
		var z := 12.0 + float(index / 2) * 28.0
		var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
		_add_box(root, Vector3(x, ground + 4.0, z), Vector3(15.0, 8.0, 11.0), Color("#5b5848"), "Factory")
		_add_box(root, Vector3(x, ground + 9.0, z), Vector3(2.0, 2.0, 18.0), Color("#9d9b71"), "Gantry")

func _add_suburb(root: Node3D, chunk_x: int, chunk_z: int) -> void:
	for index in range(5):
		var x := 7.0 + float(index % 3) * 22.0
		var z := 8.0 + float(index / 3) * 28.0
		var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
		_add_box(root, Vector3(x, ground + 3.0, z), Vector3(10.0, 6.0, 9.0), Color("#53604b"), "House")
		_add_tree(root, Vector3(x + 5.0, ground, z + 4.0), 5.0 + float(index % 3) * 2.0, Color("#4e7645"))

func _add_wilderness(root: Node3D, chunk_x: int, chunk_z: int, biome: String) -> void:
	var count := 3 if biome in ["desert", "cold_desert", "badland", "alpine_scree"] else 8
	for index in range(count):
		var x := 3.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 211 + index) * 58.0
		var z := 3.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 233 + index) * 58.0
		var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
		if biome in ["desert", "cold_desert", "badland", "alpine_scree"]:
			_add_box(root, Vector3(x, ground + 1.5, z), Vector3(2.0, 3.0, 2.4), Color("#697055"), "Rock")
		else:
			_add_tree(root, Vector3(x, ground, z), 4.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 251 + index) * 6.0, Color("#4b784a"))

func _add_tree(root: Node3D, position: Vector3, height: float, color: Color) -> void:
	var trunk := StaticBody3D.new()
	trunk.name = "Tree"
	trunk.position = position
	var visual := MeshInstance3D.new()
	var cone := CylinderMesh.new()
	cone.top_radius = 0.18
	cone.bottom_radius = 0.5
	cone.height = height
	visual.mesh = cone
	visual.position.y = height * 0.5
	visual.material_override = _material(color)
	trunk.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 0.5
	shape.height = height
	collision.shape = shape
	collision.position.y = height * 0.5
	trunk.add_child(collision)
	root.add_child(trunk)

func _add_resource(root:Node3D,record:Dictionary)->void:
	var kind:=str(record.kind);var x:=float(record.local_x);var z:=float(record.local_z)
	var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
	var pickup = RESOURCE_PICKUP.new()
	pickup.name = kind.capitalize() + "Pickup"
	pickup.set_meta("resource_id",str(record.id))
	pickup.kind = kind
	pickup.position = Vector3(x, ground + 1.1, z)
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = 0.8
	collision.shape = shape
	pickup.add_child(collision)
	var visual := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.36
	sphere.height = 0.72
	visual.mesh = sphere
	visual.material_override = _material(Color("#9fd477") if kind in ["food", "water"] else Color("#d3ba72"), true)
	pickup.add_child(visual)
	root.add_child(pickup)

func _add_hazard(root:Node3D,record:Dictionary)->void:
	var hazard:=Node3D.new();hazard.name="Hazard_"+str(record.id).replace(":","_");hazard.add_to_group("hazard");hazard.set_meta("hazard_id",str(record.id));hazard.set_meta("kind",str(record.kind))
	hazard.position=Vector3(float(record.local_x),ground_height(root.global_position+Vector3(float(record.local_x),0.0,float(record.local_z)))+.06,float(record.local_z))
	var marker:=MeshInstance3D.new();var mesh:=CylinderMesh.new();mesh.top_radius=2.2;mesh.bottom_radius=2.2;mesh.height=.12;marker.mesh=mesh
	var color:=Color("#8c7a43")
	if str(record.kind)=="contamination":color=Color("#9b6a37")
	elif str(record.kind)=="floodwater":color=Color("#4d8c9d")
	elif str(record.kind)=="thermal":color=Color("#c0643f")
	elif str(record.kind)=="sinkhole":color=Color("#574a44")
	marker.material_override=_material(color,true);hazard.add_child(marker);root.add_child(hazard)

func _add_grapple_anchor(root: Node3D, chunk_x: int, chunk_z: int) -> void:
	var x := 12.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 431) * 40.0
	var z := 12.0 + RNG.unit(generator.seed, chunk_x, chunk_z, 433) * 40.0
	var ground := ground_height(root.global_position + Vector3(x, 0.0, z))
	var anchor := Node3D.new()
	anchor.name = "GrappleAnchor"
	anchor.position = Vector3(x, ground + 9.0, z)
	anchor.add_to_group("grapple_anchor")
	var mesh := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.45
	ring.outer_radius = 0.65
	mesh.mesh = ring
	mesh.material_override = _material(Color("#d5f29d"), true)
	anchor.add_child(mesh)
	root.add_child(anchor)

func _add_box(root: Node3D, position: Vector3, size: Vector3, color: Color, node_name: String) -> void:
	var body := StaticBody3D.new()
	body.name = node_name
	body.position = position
	var visual := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	visual.mesh = box
	visual.material_override = _material(color)
	body.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	root.add_child(body)

func _terrain_material(biome: String, family: String) -> StandardMaterial3D:
	var color: Color = {"ocean": Color("#2e5d6b"), "coast": Color("#8f9b70"), "desert": Color("#aa9564"), "alpine": Color("#82919b"), "nival_zone": Color("#d5e5df"), "wetland": Color("#4b7665"), "temperate_forest": Color("#55794e"), "rainforest": Color("#3e7146")}.get(biome, Color("#5e7650"))
	if family == "industrial_ruin": color = Color("#686653")
	if family == "reclaimed_city": color = Color("#576b59")
	if family == "flooded_city": color = Color("#466d72")
	if family == "overgrown_suburb": color = Color("#5f7951")
	var material := _material(color)
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material

func _material(color: Color, emissive := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.9
	if emissive:
		material.emission_enabled = true
		material.emission = color
	return material

func _chunk_id(x: int, z: int) -> String:
	return "%d:%d" % [x, z]
