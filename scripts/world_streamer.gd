class_name WorldStreamer
extends Node3D

signal region_changed(region: Dictionary)
signal chunk_stats_changed(stats: Dictionary)
signal streaming_hitch(sample:Dictionary)
signal origin_rebased(delta: Vector3)

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
const LANDMARK_GRAPPLE := preload("res://scripts/world_landmark_grapple.gd")
const WILDLIFE_ECOLOGY := preload("res://scripts/world_wildlife_ecology.gd")
const WILDLIFE_AGENT := preload("res://scripts/wildlife_agent.gd")
const REGION_PRESENTATION := preload("res://scripts/world_region_presentation.gd")
const RESOURCE_PLACEMENT := preload("res://scripts/world_resource_placement.gd")
const HAZARD_PLACEMENT := preload("res://scripts/world_hazard_placement.gd")
const STREAMING_TELEMETRY := preload("res://scripts/world_streaming_telemetry.gd")
const CHUNK_MEMORY_TELEMETRY := preload("res://scripts/world_chunk_memory_telemetry.gd")
const MEGASTRUCTURE_ROUTE_VALIDATOR := preload("res://scripts/world_megastructure_route_validator.gd")

const GRID := 16
const ACTIVE_RADIUS := 2
const ACTIVE_CHUNKS_PER_FRAME := 1
const COLLISION_LODS_PER_FRAME := 1
const FAR_CHUNKS_PER_FRAME := 2
const FEATURE_BUILD_RADIUS := 1.5
const FEATURE_CHUNKS_PER_FRAME := 1
const REVEAL_ACTIVE_PRIORITY_WEIGHT := 2.5
const REVEAL_BACKGROUND_PRIORITY_WEIGHT := 4.0

var generator
var player: SpeedPlayer
var chunks: Dictionary = {}
var current_center := Vector2i(2147483647, 2147483647)
var current_region_id := ""
var origin
var scheduler
var pending_chunks: Dictionary = {}
var queued_active_chunks: Dictionary = {}
var pending_collision_lods: Dictionary = {}
var chunk_cache
var far_chunks: Dictionary = {}
var active_ids: Dictionary = {}
var landmarks=LANDMARKS.new()
var streaming_telemetry=STREAMING_TELEMETRY.new()
var shelters: Array[Node3D] = []
var material_cache: Dictionary = {}
var refresh_metrics: Dictionary = {}
var last_refresh_metrics: Dictionary = {}
var megastructure_debug_visible := false

func configure(next_seed: int, next_player: SpeedPlayer) -> void:
	generator = GENERATOR.new(next_seed)
	origin = WORLD_ORIGIN.new(GENERATOR.CHUNK_SIZE)
	scheduler = CHUNK_SCHEDULER.new(next_seed)
	chunk_cache = CHUNK_CACHE.new(128)
	player = next_player
	shelters.clear()
	material_cache.clear()
	queued_active_chunks.clear()
	pending_collision_lods.clear()
	megastructure_debug_visible = false
	name = "ExpeditionWorld"
	refresh(true)

func _process(_delta: float) -> void:
	refresh(false)
	var hitch:=streaming_telemetry.record_refresh(float(last_refresh_metrics.get("refresh_ms",0.0)),_streaming_context())
	if not hitch.is_empty():streaming_hitch.emit(hitch)

func _exit_tree() -> void:
	if scheduler: scheduler.shutdown()

func refresh(force: bool) -> void:
	if generator == null or player == null: return
	var started:=Time.get_ticks_usec()
	refresh_metrics={"active_chunk_build_ms":0.0,"far_chunk_build_ms":0.0,"feature_build_ms":0.0,"collision_lod_ms":0.0,"macro_silhouette_ms":0.0,"sector_shell_ms":0.0,"structure_collision_ms":0.0,"traversal_detail_ms":0.0,"active_chunks_built":0,"collision_lods_built":0,"far_chunks_built":0,"feature_chunks_built":0,"structure_collisions_built":0}
	_attach_completed(scheduler.wait_for_all() if force else scheduler.poll(),force)
	var rebase: Vector3 = origin.rebase_delta(player.global_position)
	if rebase != Vector3.ZERO:
		player.global_position += rebase
		for root: Node3D in chunks.values(): root.global_position += rebase
		for root: Node3D in far_chunks.values(): root.global_position += rebase
		origin_rebased.emit(rebase)
	var center: Vector2i = origin.chunk_at_local(player.global_position)
	if not force and center == current_center:
		var active_built:=_build_pending_chunks()
		var collision_started:=Time.get_ticks_usec()
		_update_collision_lods(false,active_built==0)
		refresh_metrics["collision_lod_ms"]=float(Time.get_ticks_usec()-collision_started)/1000.0
		var background_builds_allowed:=active_built==0 and int(refresh_metrics.collision_lods_built)==0
		_update_far_terrain(false,background_builds_allowed)
		_build_pending_features(false,background_builds_allowed)
		_update_region()
		_finish_refresh_metrics(started)
		return
	current_center = center
	var wanted: Dictionary = {}
	for z in range(center.y - ACTIVE_RADIUS, center.y + ACTIVE_RADIUS + 1):
		for x in range(center.x - ACTIVE_RADIUS, center.x + ACTIVE_RADIUS + 1):
			var id := _chunk_id(x, z)
			wanted[id] = true
			if not chunks.has(id) and not pending_chunks.has(id):
				if chunk_cache and not chunk_cache.fetch(id).is_empty():
					queued_active_chunks[id]=Vector2i(x,z)
				else: pending_chunks[id] = scheduler.request(x, z, 0, _chunk_priority(center, Vector2i(x, z)))
	active_ids=wanted.duplicate()
	if force:
		_attach_completed(scheduler.wait_for_all(),true)
	var preload_targets:=PRELOAD_CORRIDOR.targets(center,_preload_heading())
	for id in preload_targets.keys():
		if chunks.has(id) or pending_chunks.has(id) or (chunk_cache and not chunk_cache.fetch(id).is_empty()):continue
		var chunk:Vector2i=preload_targets[id];pending_chunks[id]=scheduler.request(chunk.x,chunk.y,0,50.0-_reveal_bias(chunk)*REVEAL_BACKGROUND_PRIORITY_WEIGHT)
		wanted[id]=true
	for id in pending_chunks.keys():
		if not wanted.has(id): scheduler.cancel(int(pending_chunks[id]));pending_chunks.erase(id)
	for id in queued_active_chunks.keys():
		if not active_ids.has(id):queued_active_chunks.erase(id)
	for id in chunks.keys():
		if not active_ids.has(id):
			var stale: Node = chunks[id]
			chunks.erase(id)
			stale.queue_free()
	var active_built:=_build_pending_chunks(force)
	var collision_started:=Time.get_ticks_usec()
	_update_collision_lods(force,force or active_built==0)
	refresh_metrics["collision_lod_ms"]=float(Time.get_ticks_usec()-collision_started)/1000.0
	var background_builds_allowed:=force or (active_built==0 and int(refresh_metrics.collision_lods_built)==0)
	_update_far_terrain(force,background_builds_allowed)
	_build_pending_features(force,background_builds_allowed)
	_update_region()
	chunk_stats_changed.emit({"active": chunks.size(), "center": [center.x, center.y],"memory":chunk_memory_snapshot()})
	_finish_refresh_metrics(started)

func _attach_completed(results: Array, build_features:=false) -> void:
	for result: Dictionary in results:
		var key: Dictionary = result.get("key", {})
		var id := _chunk_id(int(key.get("chunk_x", 0)), int(key.get("chunk_z", 0)))
		if int(pending_chunks.get(id,-1)) != int(result.get("token",-2)): continue
		pending_chunks.erase(id)
		if str(result.get("status", "")) == "ok" and not chunks.has(id):
			chunk_cache.put(id,result.get("descriptor",{}))
			if active_ids.has(id):queued_active_chunks[id]=Vector2i(int(key.get("chunk_x",0)),int(key.get("chunk_z",0)))

func _build_pending_chunks(build_all:=false)->int:
	var candidates:Array=[]
	for id:String in queued_active_chunks.keys():
		if not active_ids.has(id) or chunks.has(id):
			queued_active_chunks.erase(id)
			continue
		var chunk:=queued_active_chunks[id] as Vector2i
		var distance:=Vector2(float(chunk.x-current_center.x),float(chunk.y-current_center.y)).length()
		candidates.append({"id":id,"chunk":chunk,"priority":_chunk_priority(current_center,chunk),"distance":distance})
	candidates.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)<float(b.priority) if not is_equal_approx(float(a.priority),float(b.priority)) else str(a.id)<str(b.id))
	var built:=0
	for candidate:Dictionary in candidates:
		if not build_all and built>=ACTIVE_CHUNKS_PER_FRAME:break
		var id:=str(candidate.id);var chunk:=candidate.chunk as Vector2i
		if not queued_active_chunks.has(id):continue
		queued_active_chunks.erase(id)
		_remove_far_chunk(id)
		chunks[id]=_build_chunk(chunk.x,chunk.y,build_all)
		built+=1
	return built

func _remove_far_chunk(id:String)->void:
	if not far_chunks.has(id):return
	var far:Node=far_chunks[id]
	far_chunks.erase(id)
	far.queue_free()

func _streaming_context()->Dictionary:
	var memory:=chunk_memory_snapshot()
	return {"active":chunks.size(),"pending":pending_chunks.size(),"queued":queued_active_chunks.size(),"cached":chunk_cache.size() if chunk_cache else 0,"far":far_chunks.size(),"minimum_payload_bytes":memory.minimum_payload_bytes,"static_memory_bytes":memory.static_memory_bytes,"phases":last_refresh_metrics.duplicate(true)}

func streaming_diagnostics()->Dictionary:
	return {"refresh":last_refresh_metrics.duplicate(true),"telemetry":streaming_telemetry.summary(),"memory":chunk_memory_snapshot()}

func set_megastructure_debug_visible(visible: bool) -> void:
	megastructure_debug_visible = visible
	for root: Node3D in chunks.values():
		var debug := root.get_node_or_null("MegastructureTraversal/MegastructureDebug") as Node3D
		if debug:
			debug.visible = visible

func _finish_refresh_metrics(started:int)->void:
	refresh_metrics["refresh_ms"]=float(Time.get_ticks_usec()-started)/1000.0
	refresh_metrics["pending_features"]=0
	for root:Node3D in chunks.values():
		if not bool(root.get_meta("features_ready",false)):refresh_metrics["pending_features"]=int(refresh_metrics.pending_features)+1
	refresh_metrics["queued_active_chunks"]=queued_active_chunks.size()
	refresh_metrics["pending_collision_lods"]=pending_collision_lods.size()
	last_refresh_metrics=refresh_metrics.duplicate(true)

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
	var movement_priority:=offset.length_squared()-offset.normalized().dot(velocity.normalized())*.8-offset.normalized().dot(-forward.normalized())*.45 if not is_zero_approx(offset.length_squared()) else -1.0
	return movement_priority-_reveal_bias(target)*REVEAL_ACTIVE_PRIORITY_WEIGHT

func _phase_priority(chunk: Vector2i) -> float:
	return Vector2(float(chunk.x-current_center.x),float(chunk.y-current_center.y)).length_squared()-_reveal_bias(chunk)*REVEAL_BACKGROUND_PRIORITY_WEIGHT

func _reveal_bias(chunk: Vector2i) -> float:
	return generator.megastructure_reveal_priority(chunk.x,chunk.y) if generator else 0.0

func sample_at(world_position: Vector3) -> Dictionary:
	var canonical: Vector3 = origin.world_position(world_position) if origin else world_position
	return generator.sample(canonical.x, canonical.z) if generator else {}

func ground_height(world_position: Vector3) -> float:
	var canonical: Vector3 = origin.world_position(world_position) if origin else world_position
	var chunk := Vector2i(floori(canonical.x / GENERATOR.CHUNK_SIZE), floori(canonical.z / GENERATOR.CHUNK_SIZE))
	var descriptor: Dictionary = chunk_cache.fetch(_chunk_id(chunk.x, chunk.y)) if chunk_cache else {}
	if descriptor.is_empty(): descriptor = generator.chunk_descriptor(chunk.x, chunk.y)
	return _terrain_height(descriptor, canonical.x, canonical.z)

func place_material_marker(world_position: Vector3, record: Dictionary = {}) -> bool:
	if origin == null: return false
	var chunk: Vector2i = origin.chunk_at_local(world_position)
	var root: Node3D = chunks.get(_chunk_id(chunk.x, chunk.y)) as Node3D
	if root == null: return false
	var marker := Node3D.new()
	marker.name = "MaterialMarker"
	marker.set_meta("temporary_material", true)
	marker.set_meta("record", record.duplicate(true))
	root.add_child(marker)
	marker.global_position = world_position
	var pole := MeshInstance3D.new()
	var pole_mesh := CylinderMesh.new()
	pole_mesh.top_radius = 0.06
	pole_mesh.bottom_radius = 0.09
	pole_mesh.height = 1.0
	pole.mesh = pole_mesh
	pole.position.y = 0.5
	pole.material_override = _material(Color("#d3ba72"), true)
	marker.add_child(pole)
	var flag := MeshInstance3D.new()
	var flag_mesh := BoxMesh.new()
	flag_mesh.size = Vector3(0.45, 0.24, 0.04)
	flag.mesh = flag_mesh
	flag.position = Vector3(0.23, 0.88, 0.0)
	flag.material_override = _material(Color("#9fd477"), true)
	marker.add_child(flag)
	return true

func place_temporary_shelter(world_position: Vector3, record: Dictionary = {}) -> bool:
	if origin == null: return false
	var chunk: Vector2i = origin.chunk_at_local(world_position)
	var root: Node3D = chunks.get(_chunk_id(chunk.x, chunk.y)) as Node3D
	if root == null: return false
	var shelter := Node3D.new()
	shelter.name = "TemporaryShelter"
	shelter.set_meta("temporary_shelter", true)
	shelter.set_meta("record", record.duplicate(true))
	shelter.set_meta("cover_radius", 3.2)
	root.add_child(shelter)
	shelter.global_position = world_position
	var roof := MeshInstance3D.new()
	var roof_mesh := PrismMesh.new()
	roof_mesh.left_to_right = 0.5
	roof_mesh.size = Vector3(3.4, 1.2, 2.8)
	roof.mesh = roof_mesh
	roof.position.y = 1.9
	roof.material_override = _material(Color("#66754c"))
	shelter.add_child(roof)
	for offset in [Vector3(-1.35, 0.7, -0.9), Vector3(1.35, 0.7, -0.9), Vector3(-1.35, 0.7, 0.9), Vector3(1.35, 0.7, 0.9)]:
		var post := MeshInstance3D.new()
		var post_mesh := CylinderMesh.new()
		post_mesh.top_radius = 0.07
		post_mesh.bottom_radius = 0.10
		post_mesh.height = 1.4
		post.mesh = post_mesh
		post.position = offset
		post.material_override = _material(Color("#9a7650"))
		shelter.add_child(post)
	shelters.append(shelter)
	return true

func place_temporary_platform(world_position: Vector3, forward: Vector3, record: Dictionary = {}) -> bool:
	if origin == null: return false
	var chunk: Vector2i = origin.chunk_at_local(world_position)
	var root: Node3D = chunks.get(_chunk_id(chunk.x, chunk.y)) as Node3D
	if root == null: return false
	var platform := StaticBody3D.new()
	platform.name = "TemporaryPlatform"
	platform.set_meta("temporary_traversal", true)
	platform.set_meta("record", record.duplicate(true))
	root.add_child(platform)
	platform.global_position = world_position + Vector3(0.0, 0.18, 0.0)
	var planar := Vector3(forward.x, 0.0, forward.z).normalized()
	if planar.length() > 0.1: platform.rotation.y = atan2(planar.x, planar.z)
	var visual := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(3.6, 0.36, 1.8)
	visual.mesh = mesh
	visual.material_override = _material(Color("#a17649"))
	platform.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(3.6, 0.36, 1.8)
	collision.shape = shape
	platform.add_child(collision)
	return true

func shelter_cover_at(world_position: Vector3) -> float:
	var active_shelters: Array[Node3D] = []
	var cover := 0.0
	for shelter: Node3D in shelters:
		if not is_instance_valid(shelter): continue
		active_shelters.append(shelter)
		var radius := float(shelter.get_meta("cover_radius", 0.0))
		var offset := shelter.global_position - world_position
		offset.y = 0.0
		if radius > 0.0 and offset.length() < radius:
			cover = maxf(cover, 1.0 - offset.length() / radius)
	shelters = active_shelters
	return cover

func landmark_at(world_position: Vector3, range: float = 12.0) -> Dictionary:
	if generator == null or origin == null: return {}
	var region: Dictionary = generator.region_at(origin.world_position(world_position))
	var record: Dictionary = landmarks.record_for(generator.seed, region)
	if record.is_empty(): return {}
	var position: Vector3 = origin.local_chunk_position(Vector2i(int(record.chunk_x), int(record.chunk_z))) + Vector3(float(record.local_x), 0.0, float(record.local_z))
	position.y = ground_height(position)
	return record if position.distance_to(world_position) <= range else {}

func _update_region() -> void:
	var region: Dictionary = generator.region_at(origin.world_position(player.global_position))
	if str(region.id) == current_region_id: return
	current_region_id = str(region.id)
	region_changed.emit(region)

func _build_chunk(chunk_x: int, chunk_z: int, build_features:=false) -> Node3D:
	var started:=Time.get_ticks_usec()
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
	var interior := _is_megastructure_interior(descriptor)
	root.set_meta("megastructure_interior", interior)
	var megastructure_lod: Dictionary = descriptor.get("megastructure_lod", {})
	root.set_meta("megastructure_collision_ready", (megastructure_lod.get("active_collisions", []) as Array).is_empty())
	var mesh := _terrain_mesh(chunk_x, chunk_z, descriptor, render_grid)
	var terrain := StaticBody3D.new()
	terrain.name = "Terrain"
	var visual := MeshInstance3D.new()
	visual.mesh = mesh
	visual.material_override = _interior_material() if interior else _terrain_material(str(descriptor.biome), str(descriptor.region.family))
	terrain.add_child(visual)
	terrain.add_child(_collision_shape(chunk_x,chunk_z,collision_grid,descriptor))
	root.add_child(terrain)
	var shell_started := Time.get_ticks_usec()
	_add_megastructure_shells(root, megastructure_lod)
	refresh_metrics["sector_shell_ms"] = float(refresh_metrics.sector_shell_ms) + float(Time.get_ticks_usec() - shell_started) / 1000.0
	root.set_meta("features_ready",build_features)
	if build_features:_add_features(root, chunk_x, chunk_z, descriptor)
	refresh_metrics["active_chunk_build_ms"]=float(refresh_metrics.active_chunk_build_ms)+float(Time.get_ticks_usec()-started)/1000.0
	refresh_metrics["active_chunks_built"]=int(refresh_metrics.active_chunks_built)+1
	return root

func _build_pending_features(build_all:=false,allow_build:=true)->void:
	if not build_all and not allow_build:return
	var candidates:Array=[]
	for root:Node3D in chunks.values():
		if bool(root.get_meta("features_ready",false)):continue
		var chunk:=Vector2i(int(root.get_meta("chunk_x",0)),int(root.get_meta("chunk_z",0)));var distance:=Vector2(float(chunk.x-current_center.x),float(chunk.y-current_center.y)).length()
		if build_all or distance<=FEATURE_BUILD_RADIUS:candidates.append({"root":root,"priority":_phase_priority(chunk)})
	candidates.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)<float(b.priority))
	var built:=0
	for candidate:Dictionary in candidates:
		if not build_all and built>=FEATURE_CHUNKS_PER_FRAME:break
		var root:=candidate.root as Node3D
		if root==null or not is_instance_valid(root):continue
		var descriptor:=root.get_meta("descriptor",{}) as Dictionary
		if descriptor.is_empty():continue
		var started:=Time.get_ticks_usec()
		_add_features(root,int(root.get_meta("chunk_x",0)),int(root.get_meta("chunk_z",0)),descriptor)
		if bool(root.get_meta("megastructure_interior",false)):
			refresh_metrics["traversal_detail_ms"]=float(refresh_metrics.traversal_detail_ms)+float(Time.get_ticks_usec()-started)/1000.0
		root.set_meta("features_ready",true)
		refresh_metrics["feature_build_ms"]=float(refresh_metrics.feature_build_ms)+float(Time.get_ticks_usec()-started)/1000.0
		refresh_metrics["feature_chunks_built"]=int(refresh_metrics.feature_chunks_built)+1
		built+=1

func _update_collision_lods(build_all:=false,allow_build:=true)->void:
	for id in pending_collision_lods.keys():
		if not chunks.has(id):pending_collision_lods.erase(id)
	for id:String in chunks.keys():
		var root:=chunks[id] as Node3D
		var chunk_x:=int(root.get_meta("chunk_x",0));var chunk_z:=int(root.get_meta("chunk_z",0));var distance:=Vector2(float(chunk_x-current_center.x),float(chunk_z-current_center.y)).length();var grid:=COLLISION_LOD.grid_for_distance(distance)
		if int(root.get_meta("collision_grid",GRID))==grid and bool(root.get_meta("megastructure_collision_ready",true)):
			pending_collision_lods.erase(id)
			continue
		pending_collision_lods[id]=grid
	if not build_all and not allow_build:return
	var candidates:Array=[]
	for id:String in pending_collision_lods.keys():
		var root:=chunks.get(id) as Node3D
		if root==null:continue
		var chunk_x:=int(root.get_meta("chunk_x",0));var chunk_z:=int(root.get_meta("chunk_z",0));var chunk:=Vector2i(chunk_x,chunk_z)
		candidates.append({"id":id,"root":root,"priority":_phase_priority(chunk),"grid":int(pending_collision_lods[id])})
	candidates.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)<float(b.priority) if not is_equal_approx(float(a.priority),float(b.priority)) else str(a.id)<str(b.id))
	var built:=0
	for candidate:Dictionary in candidates:
		if not build_all and built>=COLLISION_LODS_PER_FRAME:break
		var id:=str(candidate.id);var root:=candidate.root as Node3D;var grid:=int(candidate.grid)
		if root==null or not is_instance_valid(root) or (int(root.get_meta("collision_grid",GRID))==grid and bool(root.get_meta("megastructure_collision_ready",true))):
			pending_collision_lods.erase(id)
			continue
		var terrain:=root.get_node_or_null("Terrain") as StaticBody3D
		if terrain==null:
			pending_collision_lods.erase(id)
			continue
		var chunk_x:=int(root.get_meta("chunk_x",0));var chunk_z:=int(root.get_meta("chunk_z",0));var descriptor:=root.get_meta("descriptor",{}) as Dictionary;var retiring:CollisionShape3D=null
		if int(root.get_meta("collision_grid",GRID))!=grid:retiring=COLLISION_HANDOFF.install(terrain,_collision_shape(chunk_x,chunk_z,grid,descriptor))
		if not bool(root.get_meta("megastructure_collision_ready",true)):
			var structure_started:=Time.get_ticks_usec()
			_install_megastructure_collision(root,descriptor.get("megastructure_lod",{}) as Dictionary)
			root.set_meta("megastructure_collision_ready",true)
			refresh_metrics["structure_collision_ms"]=float(refresh_metrics.structure_collision_ms)+float(Time.get_ticks_usec()-structure_started)/1000.0
			refresh_metrics["structure_collisions_built"]=int(refresh_metrics.structure_collisions_built)+1
		root.set_meta("collision_grid",grid)
		pending_collision_lods.erase(id)
		refresh_metrics["collision_lods_built"]=int(refresh_metrics.collision_lods_built)+1
		if retiring:COLLISION_HANDOFF.retire_after_physics_frame(get_tree(),retiring)
		built+=1

func _collision_shape(chunk_x:int,chunk_z:int,grid:int,descriptor:Dictionary)->CollisionShape3D:
	var collision:=CollisionShape3D.new();collision.shape=COLLISION_MESH.heightmap(generator,GENERATOR.CHUNK_SIZE,chunk_x,chunk_z,grid,func(world_x:float,world_z:float)->float:return _terrain_height(descriptor,world_x,world_z))
	var step:=GENERATOR.CHUNK_SIZE/float(grid);collision.position=Vector3(GENERATOR.CHUNK_SIZE*.5,0.0,GENERATOR.CHUNK_SIZE*.5);collision.scale=Vector3(step,step,step)
	return collision

func _update_far_terrain(build_all:=false,allow_build:=true)->void:
	var wanted:=FAR_TERRAIN.targets(current_center,ACTIVE_RADIUS)
	for id in far_chunks.keys():
		if not wanted.has(id) or chunks.has(id) or (active_ids.has(id) and pending_chunks.has(id)):
			var stale:Node=far_chunks[id]
			far_chunks.erase(id)
			stale.queue_free()
	if not build_all and not allow_build:return
	var candidates:Array=[]
	for id:String in wanted.keys():
		if chunks.has(id) or (active_ids.has(id) and pending_chunks.has(id)) or far_chunks.has(id):continue
		var chunk:Vector2i=wanted[id];candidates.append({"id":id,"chunk":chunk,"priority":_phase_priority(chunk)})
	candidates.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)<float(b.priority) if not is_equal_approx(float(a.priority),float(b.priority)) else str(a.id)<str(b.id))
	var built:=0
	for candidate:Dictionary in candidates:
		if not build_all and built>=FAR_CHUNKS_PER_FRAME:break
		var id:=str(candidate.id);var chunk:=candidate.chunk as Vector2i;far_chunks[id]=_build_far_chunk(chunk.x,chunk.y)
		built+=1

func _build_far_chunk(chunk_x:int,chunk_z:int)->Node3D:
	var started:=Time.get_ticks_usec()
	var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z);var root:=Node3D.new()
	root.name="FarChunk_%d_%d"%[chunk_x,chunk_z];root.position=origin.local_chunk_position(Vector2i(chunk_x,chunk_z));root.set_meta("impostor",true);root.set_meta("render_grid",FAR_TERRAIN.GRID)
	var visual:=MeshInstance3D.new();visual.mesh=_terrain_mesh(chunk_x,chunk_z,descriptor,FAR_TERRAIN.GRID);visual.material_override=_interior_material() if _is_megastructure_interior(descriptor) else _silhouette_material(str(descriptor.biome),str(descriptor.region.family))
	root.add_child(visual)
	var silhouette_started:=Time.get_ticks_usec()
	_add_macro_silhouettes(root,descriptor.get("megastructure_lod",{}) as Dictionary)
	refresh_metrics["macro_silhouette_ms"]=float(refresh_metrics.macro_silhouette_ms)+float(Time.get_ticks_usec()-silhouette_started)/1000.0
	add_child(root)
	refresh_metrics["far_chunk_build_ms"]=float(refresh_metrics.far_chunk_build_ms)+float(Time.get_ticks_usec()-started)/1000.0
	refresh_metrics["far_chunks_built"]=int(refresh_metrics.far_chunks_built)+1
	return root

func _add_macro_silhouettes(root: Node3D, lod: Dictionary) -> void:
	var host := Node3D.new()
	host.name = "MegastructureMacroSilhouettes"
	var added := 0
	for record: Dictionary in lod.get("macro_silhouettes", []):
		for spec: Dictionary in _megastructure_shell_specs(record):
			_add_megastructure_visual_box(host, root, spec, Color("#27312f"), "MacroSilhouette")
			added += 1
	if added > 0:
		root.add_child(host)
	else:
		host.queue_free()

func _add_megastructure_shells(root: Node3D, lod: Dictionary) -> void:
	var host := Node3D.new()
	host.name = "MegastructureShell"
	var added := 0
	for record: Dictionary in lod.get("sector_shells", []):
		for spec: Dictionary in _megastructure_shell_specs(record):
			_add_megastructure_visual_box(host, root, spec, Color("#3a453d"), "SectorShell")
			added += 1
	if added > 0:
		root.add_child(host)
	else:
		host.queue_free()

func _install_megastructure_collision(root: Node3D, lod: Dictionary) -> void:
	var records: Array = lod.get("active_collisions", [])
	if records.is_empty() or root.get_node_or_null("MegastructureCollision") != null:
		return
	var body := StaticBody3D.new()
	body.name = "MegastructureCollision"
	var added := 0
	for record: Dictionary in records:
		for spec: Dictionary in _megastructure_shell_specs(record):
			var collision := CollisionShape3D.new()
			collision.name = "StructureCollision"
			collision.position = _megastructure_local_point(root, spec.get("position", Vector3.ZERO))
			var shape := BoxShape3D.new()
			shape.size = spec.get("size", Vector3.ONE)
			collision.shape = shape
			body.add_child(collision)
			added += 1
	if added > 0:
		root.add_child(body)
	else:
		body.queue_free()

func _megastructure_shell_specs(record: Dictionary) -> Array:
	var bounds: Dictionary = record.get("bounds", {})
	var minimum := _megastructure_point(bounds.get("min", []))
	var maximum := _megastructure_point(bounds.get("max", []))
	var floor_y := float(record.get("floor_y", 0))
	var ceiling_y := float(record.get("ceiling_y", floor_y))
	if maximum.x <= minimum.x or maximum.z <= minimum.z or ceiling_y <= floor_y:
		return []
	var width := maximum.x - minimum.x
	var depth := maximum.z - minimum.z
	var center_x := (minimum.x + maximum.x) * 0.5
	var center_z := (minimum.z + maximum.z) * 0.5
	var specs: Array = [{"position":Vector3(center_x, ceiling_y - 1.0, center_z), "size":Vector3(width, 2.0, depth)}]
	for face: String in record.get("wall_faces", []):
		match face:
			"x_min": specs.append({"position":Vector3(minimum.x + 1.0, (floor_y + ceiling_y) * 0.5, center_z), "size":Vector3(2.0, ceiling_y - floor_y, depth)})
			"x_max": specs.append({"position":Vector3(maximum.x - 1.0, (floor_y + ceiling_y) * 0.5, center_z), "size":Vector3(2.0, ceiling_y - floor_y, depth)})
			"z_min": specs.append({"position":Vector3(center_x, (floor_y + ceiling_y) * 0.5, minimum.z + 1.0), "size":Vector3(width, ceiling_y - floor_y, 2.0)})
			"z_max": specs.append({"position":Vector3(center_x, (floor_y + ceiling_y) * 0.5, maximum.z - 1.0), "size":Vector3(width, ceiling_y - floor_y, 2.0)})
	return specs

func _add_megastructure_visual_box(host: Node3D, root: Node3D, spec: Dictionary, color: Color, node_name: String) -> void:
	var visual := MeshInstance3D.new()
	visual.name = node_name
	visual.position = _megastructure_local_point(root, spec.get("position", Vector3.ZERO))
	var mesh := BoxMesh.new()
	mesh.size = spec.get("size", Vector3.ONE)
	visual.mesh = mesh
	visual.material_override = _material(color)
	host.add_child(visual)

func _megastructure_local_point(root: Node3D, point: Vector3) -> Vector3:
	return point - Vector3(float(int(root.get_meta("chunk_x", 0))) * GENERATOR.CHUNK_SIZE, 0.0, float(int(root.get_meta("chunk_z", 0))) * GENERATOR.CHUNK_SIZE)

func _megastructure_point(value: Variant) -> Vector3:
	if value is Array and value.size() == 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return Vector3.ZERO

func _megastructure_point_fp(value: Variant) -> Vector3:
	if value is Array and value.size() == 3:
		return Vector3(float(value[0]) / 1024.0, float(value[1]) / 1024.0, float(value[2]) / 1024.0)
	return Vector3.ZERO

func _terrain_mesh(chunk_x: int, chunk_z: int, descriptor: Dictionary, grid: int = GRID) -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var step := GENERATOR.CHUNK_SIZE / float(grid)
	for z in range(grid):
		for x in range(grid):
			var a := _vertex(chunk_x, chunk_z, x, z, step, descriptor)
			var b := _vertex(chunk_x, chunk_z, x + 1, z, step, descriptor)
			var c := _vertex(chunk_x, chunk_z, x + 1, z + 1, step, descriptor)
			var d := _vertex(chunk_x, chunk_z, x, z + 1, step, descriptor)
			for vertex in [a, b, c, a, c, d]:
				surface.set_uv(Vector2(vertex.x / GENERATOR.CHUNK_SIZE, vertex.z / GENERATOR.CHUNK_SIZE))
				surface.add_vertex(vertex)
	var mesh := surface.commit()
	mesh.resource_name = str(descriptor.biome) + "_" + str(descriptor.region.family)
	return mesh

func _vertex(chunk_x: int, chunk_z: int, x: int, z: int, step: float, descriptor: Dictionary) -> Vector3:
	var local_x := float(x) * step
	var local_z := float(z) * step
	return Vector3(local_x, _terrain_height(descriptor, float(chunk_x) * GENERATOR.CHUNK_SIZE + local_x, float(chunk_z) * GENERATOR.CHUNK_SIZE + local_z), local_z)

func _terrain_height(descriptor: Dictionary, world_x: float, world_z: float) -> float:
	var interior := _megastructure_interior(descriptor)
	if not interior.is_empty():
		return float(interior.get("floor_y", 0))
	return float(generator.sample(world_x, world_z).get("elevation", 0.0))

func _is_megastructure_interior(descriptor: Dictionary) -> bool:
	return not _megastructure_interior(descriptor).is_empty()

func _megastructure_interior(descriptor: Dictionary) -> Dictionary:
	var megastructure: Dictionary = descriptor.get("megastructure", {})
	for intersection: Dictionary in megastructure.get("intersections", []):
		var macro: Dictionary = intersection.get("macro", {})
		if macro.is_empty():
			continue
		var interior: Dictionary = intersection.get("interior", {})
		if str(interior.get("terrain_mode", "")) == "flat_enclosed_floor":
			return interior
	return {}

func _add_features(root: Node3D, chunk_x: int, chunk_z: int, descriptor: Dictionary) -> void:
	if _is_megastructure_interior(descriptor):
		_add_megastructure_traversal_details(root, descriptor)
		root.set_meta("wildlife_count", 0)
		return
	var family := str(descriptor.region.family)
	var seed: int = generator.seed
	var landmark:=landmarks.for_chunk(seed,descriptor.region,chunk_x,chunk_z)
	if not landmark.is_empty():_add_landmark(root,landmark)
	_add_urban_corridors(root,descriptor.get("urban_corridors",{}))
	_add_city_corridors(root,descriptor.get("city_corridors",{}))
	if family == "reclaimed_city":
		_add_city_arterials(root,descriptor.get("city_arterials",{}))
		_add_city_secondary_roads(root,descriptor.get("city_secondary_roads",{}))
		_add_city_buildings(root,descriptor.get("city_buildings",{}),descriptor.get("city_failures",{}))
		_add_city_traversal(root,descriptor.get("city_buildings",{}),descriptor.get("city_traversal",{}),descriptor.get("city_failures",{}))
		_add_city_collapsed_routes(root,descriptor.get("city_buildings",{}),descriptor.get("city_failures",{}))
		_add_city_rooftop_resources(root,descriptor.get("city_rooftop_resources",{}))
		_add_city_vegetation(root,descriptor.get("city_vegetation",{}))
	elif family == "flooded_city":
		_add_flooded_city_routes(root,descriptor.get("flood_routes",{}))
		_add_flooded_city_structures(root,descriptor.get("flood_structures",{}))
		_add_flooded_city_ecology(root,descriptor.get("flood_ecology",{}))
	elif family == "industrial_ruin":
		_add_industrial_structures(root,descriptor.get("industrial_structures",{}))
		_add_industrial_traversal(root,descriptor.get("industrial_traversal",{}))
		_add_industrial_hazards(root,descriptor.get("industrial_hazards",{}))
		_add_industrial_resources(root,descriptor.get("industrial_resources",{}))
	elif family == "overgrown_suburb":
		_add_suburb_roads(root,descriptor.get("suburb_roads",{}))
		_add_suburb_parcels(root,descriptor.get("suburb_parcels",{}),descriptor.get("suburb_transitions",{}))
		_add_suburb_transitions(root,descriptor.get("suburb_transitions",{}))
		_add_suburb_traversal(root,descriptor.get("suburb_traversal",{}))
		_add_suburb_resources(root,descriptor.get("suburb_resources",{}))
	else:
		_add_wilderness(root, chunk_x, chunk_z, str(descriptor.biome))
		_add_natural_resources(root, descriptor.get("natural_resources",{}))
	var resource:=RESOURCE_PLACEMENT.for_chunk(seed,chunk_x,chunk_z,family)
	if not resource.is_empty() and family not in ["industrial_ruin","overgrown_suburb","wilderness"]:_add_resource(root,resource)
	var hazard:=HAZARD_PLACEMENT.for_chunk(seed,chunk_x,chunk_z,str(descriptor.biome),family)
	if not hazard.is_empty() and family!="industrial_ruin":_add_hazard(root,hazard)
	var wildlife: Dictionary = WILDLIFE_ECOLOGY.generate(seed, chunk_x, chunk_z, descriptor)
	for animal: Dictionary in wildlife.get("animals", []): _add_wildlife(root, animal)
	root.set_meta("wildlife_count", (wildlife.get("animals", []) as Array).size())
	if RNG.unit(seed, chunk_x, chunk_z, 419) > 0.82:
		_add_grapple_anchor(root, chunk_x, chunk_z)

func _add_megastructure_traversal_details(root: Node3D, descriptor: Dictionary) -> void:
	if root.get_node_or_null("MegastructureTraversal") != null:
		return
	var host := Node3D.new()
	host.name = "MegastructureTraversal"
	for record: Dictionary in (descriptor.get("megastructure_lod", {}) as Dictionary).get("traversal_details", []):
		var start := _megastructure_local_point(root, _megastructure_point_fp(record.get("start_fp", [])))
		var finish := _megastructure_local_point(root, _megastructure_point_fp(record.get("end_fp", [])))
		var direction := Vector3(finish.x - start.x, 0.0, finish.z - start.z)
		var length := direction.length()
		if length <= 0.01:
			continue
		var guide := MeshInstance3D.new()
		guide.name = "TraversalGuide"
		guide.position = (start + finish) * 0.5 + Vector3(0.0, 0.12, 0.0)
		guide.rotation.y = atan2(-direction.z, direction.x)
		var mesh := BoxMesh.new()
		mesh.size = Vector3(length, 0.24, 2.0)
		guide.mesh = mesh
		guide.material_override = _material(Color("#87966b"), true)
		host.add_child(guide)
		if str(record.get("movement_mode", "")) == "grapple":
			var anchor: Array = record.get("grapple_anchor", [])
			var anchor_position := _megastructure_local_point(root, _megastructure_point(anchor)) if anchor.size() == 3 else (start + finish) * 0.5 + Vector3(0.0, MEGASTRUCTURE_ROUTE_VALIDATOR.GRAPPLE_ANCHOR_HEIGHT, 0.0)
			_add_megastructure_grapple_anchor(host, anchor_position)
	_add_megastructure_debug(host, root, descriptor)
	root.add_child(host)

func _add_megastructure_grapple_anchor(host: Node3D, position: Vector3) -> void:
	var anchor := Node3D.new()
	anchor.name = "MegastructureGrappleAnchor"
	anchor.position = position
	anchor.add_to_group("grapple_anchor")
	var visual := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.55
	ring.outer_radius = 0.75
	visual.mesh = ring
	visual.material_override = _material(Color("#cde596"), true)
	anchor.add_child(visual)
	host.add_child(anchor)

func _add_megastructure_debug(host: Node3D, root: Node3D, descriptor: Dictionary) -> void:
	var debug := Node3D.new()
	debug.name = "MegastructureDebug"
	debug.visible = megastructure_debug_visible
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, _material(Color("#68dfb0"), true))
	var added := 0
	for intersection: Dictionary in (descriptor.get("megastructure", {}) as Dictionary).get("intersections", []):
		for port: Dictionary in (intersection.get("structural_ports", []) as Array) + (intersection.get("traversal_ports", []) as Array):
			var point := _megastructure_local_point(root, _megastructure_point_fp(port.get("point_fp", [])))
			mesh.surface_add_vertex(point - Vector3(0.0, 2.0, 0.0))
			mesh.surface_add_vertex(point + Vector3(0.0, 2.0, 0.0))
			mesh.surface_add_vertex(point - Vector3(2.0, 0.0, 0.0))
			mesh.surface_add_vertex(point + Vector3(2.0, 0.0, 0.0))
			added += 1
	mesh.surface_end()
	if added > 0:
		var visual := MeshInstance3D.new()
		visual.name = "BoundaryOwnership"
		visual.mesh = mesh
		debug.add_child(visual)
	host.add_child(debug)

func _add_wildlife(root: Node3D, record: Dictionary) -> void:
	var animal := WILDLIFE_AGENT.new()
	animal.name = "Wildlife_" + str(record.id).replace(":", "_")
	animal.configure(record, player, sample_at(root.global_position+Vector3(float(record.local_x),0.0,float(record.local_z))))
	animal.add_to_group("wildlife")
	animal.set_meta("record", record.duplicate(true))
	animal.set_meta("archetype_id", str(record.archetype_id))
	animal.position = Vector3(float(record.local_x), ground_height(root.global_position + Vector3(float(record.local_x), 0.0, float(record.local_z))) + 0.45, float(record.local_z))
	var mesh := MeshInstance3D.new()
	var body := CapsuleMesh.new()
	body.radius = 0.32
	body.height = 1.1
	mesh.mesh = body
	mesh.material_override = _material(Color("#a98562") if str(record.archetype_id) == "territorial_boar" else Color("#b5a881"), true)
	animal.add_child(mesh)
	root.add_child(animal)

func _add_landmark(root:Node3D,record:Dictionary)->void:
	var landmark:=Node3D.new();landmark.name="Landmark_"+str(record.id).replace(":","_");landmark.set_meta("record",record.duplicate(true));landmark.set_meta("label",str(record.get("name",record.kind)));if record.has("taxonomy"):landmark.set_meta("taxonomy",str(record.taxonomy))
	var position:=Vector3(float(record.local_x),ground_height(root.global_position+Vector3(float(record.local_x),0.0,float(record.local_z))),float(record.local_z));landmark.position=position
	var size:=Vector3(4.0,8.0,4.0);var color:=Color("#8e9a8d")
	if str(record.kind)=="radio mast":size=Vector3(1.2,18.0,1.2);color=Color("#9db7a0")
	elif str(record.kind)=="collapsed observatory":size=Vector3(10.0,4.0,10.0);color=Color("#8b897d")
	elif str(record.kind)=="floodgate":size=Vector3(14.0,7.0,2.0);color=Color("#6d8280")
	elif str(record.kind)=="wind farm":size=Vector3(2.0,14.0,2.0);color=Color("#d4ded5")
	elif str(record.kind)=="glass conservatory":size=Vector3(9.0,6.0,7.0);color=Color("#91b8a1")
	_add_box(landmark,Vector3(0.0,size.y*.5,0.0),size,color,"LandmarkCore")
	_add_landmark_grapple_anchor(landmark,record,size.y)
	root.add_child(landmark)

func _add_landmark_grapple_anchor(landmark: Node3D, record: Dictionary, height: float) -> void:
	var spec: Dictionary = LANDMARK_GRAPPLE.anchor_spec(record, height)
	if spec.is_empty(): return
	var anchor := Node3D.new()
	anchor.name = str(spec.name)
	anchor.position = Vector3(0.0, float(spec.height), 0.0)
	anchor.add_to_group("grapple_anchor")
	anchor.set_meta("landmark_anchor", true)
	anchor.set_meta("landmark_id", str(spec.landmark_id))
	var mesh := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.55
	ring.outer_radius = 0.75
	mesh.mesh = ring
	mesh.material_override = _material(Color("#d5f29d"), true)
	anchor.add_child(mesh)
	landmark.add_child(anchor)

func _add_urban_corridors(root:Node3D,fields:Dictionary)->void:
	for corridor:Dictionary in fields.get("corridors",[]):
		var direction:Array=corridor.direction;var axis:=str(corridor.axis);var position:=Vector3(32.0,.015,32.0);position.x=2.0 if int(direction[0])<0 else 62.0 if int(direction[0])>0 else position.x;position.z=2.0 if int(direction[1])<0 else 62.0 if int(direction[1])>0 else position.z;position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(12.0,.03,float(corridor.width)) if axis=="x" else Vector3(float(corridor.width),.03,12.0);visual.name="UrbanCorridor";visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#77735f"));root.add_child(visual)

func _add_city_corridors(root:Node3D,fields:Dictionary)->void:
	for corridor:Dictionary in fields.get("corridors",[]):
		var direction:Array=corridor.direction;var axis:=str(corridor.axis);var position:=Vector3(32.0,.015,32.0);position.x=2.0 if int(direction[0])<0 else 62.0 if int(direction[0])>0 else position.x;position.z=2.0 if int(direction[1])<0 else 62.0 if int(direction[1])>0 else position.z;position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(12.0,.03,float(corridor.width)) if axis=="x" else Vector3(float(corridor.width),.03,12.0);visual.name="CityCorridor";visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#6c6658"));root.add_child(visual)

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

func _add_city_buildings(root:Node3D,massing:Dictionary,failures:Dictionary)->void:
	for building:Dictionary in massing.get("buildings",[]):
		var failure:=_city_failure(failures,str(building.id));var x:=float(building.get("x",32.0));var z:=float(building.get("z",32.0));var height:=float(building.get("height",6.0))*float(failure.get("height_scale",1.0));var color:=Color("#654f45") if str(failure.get("state",""))=="collapsed" else Color("#4f6355") if str(building.get("form",""))=="courtyard" else Color("#495852")
		_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),Vector3(float(building.get("width",4.0)),height,float(building.get("depth",4.0))),color,"Building")

func _add_city_traversal(root:Node3D,massing:Dictionary,traversal:Dictionary,failures:Dictionary)->void:
	var buildings:Dictionary={}
	for building:Dictionary in massing.get("buildings",[]):buildings[str(building.id)]=building
	for facade:Dictionary in traversal.get("facades",[]):
		var building:Dictionary=buildings.get(str(facade.get("building_id","")),{});if building.is_empty():continue
		if float(facade.ledge_height)>=float(building.height)*float(_city_failure(failures,str(building.id)).get("height_scale",1.0))-.75:continue
		var x:=float(building.x);var z:=float(building.z);var side:=str(facade.side);var outward:=Vector3(0.0,0.0,-1.0) if side=="north" else Vector3(1.0,0.0,0.0) if side=="east" else Vector3(0.0,0.0,1.0) if side=="south" else Vector3(-1.0,0.0,0.0);var half:=float(building.depth)*.5 if side in ["north","south"] else float(building.width)*.5
		var position:=Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(facade.ledge_height),z)+outward*(half+.35);var size:=Vector3(float(facade.ledge_width),.35,1.0) if side in ["north","south"] else Vector3(1.0,.35,float(facade.ledge_width));_add_box(root,position,size,Color("#6a7568"),"FacadeLedge")

func _add_city_collapsed_routes(root:Node3D,massing:Dictionary,failures:Dictionary)->void:
	var buildings:Dictionary={}
	for building:Dictionary in massing.get("buildings",[]):buildings[str(building.id)]=building
	for route:Dictionary in failures.get("collapsed_routes",[]):
		var building:Dictionary=buildings.get(str(route.get("building_id","")),{});if building.is_empty():continue
		var side:=str(route.get("side","north"));var outward:=Vector3(0.0,0.0,-1.0) if side=="north" else Vector3(1.0,0.0,0.0) if side=="east" else Vector3(0.0,0.0,1.0) if side=="south" else Vector3(-1.0,0.0,0.0);var half:=float(building.depth)*.5 if side in ["north","south"] else float(building.width)*.5;var count:=int(route.get("step_count",3));var width:=minf(float(building.width),float(building.depth))*.5
		for step in range(count):
			var progress:=float(step+1)/float(count);var x:=float(building.x)+outward.x*(half+progress*3.0);var z:=float(building.z)+outward.z*(half+progress*3.0);var height:=float(route.route_height)*progress;_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),Vector3(width,height,1.8) if side in ["north","south"] else Vector3(1.8,height,width),Color("#765f50"),"DebrisStep")

func _city_failure(failures:Dictionary,building_id:String)->Dictionary:
	for failure:Dictionary in failures.get("failures",[]):
		if str(failure.get("building_id",""))==building_id:return failure
	return {}

func _add_industrial_structures(root:Node3D,fields:Dictionary)->void:
	for factory:Dictionary in fields.get("factories",[]):
		var x:=float(factory.x);var z:=float(factory.z);var height:=float(factory.height);_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),Vector3(float(factory.width),height,float(factory.depth)),Color("#5b5848"),"IndustrialFactory")
	for tank:Dictionary in fields.get("tanks",[]):
		var x:=float(tank.x);var z:=float(tank.z);var height:=float(tank.height);_add_cylinder(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),float(tank.radius),height,Color("#727369"),"IndustrialTank")
	for gantry:Dictionary in fields.get("gantries",[]):_add_industrial_gantry(root,gantry)
	for pipe:Dictionary in fields.get("pipes",[]):_add_industrial_pipe(root,pipe)
	for conveyor:Dictionary in fields.get("conveyors",[]):
		var x:=float(conveyor.x);var z:=float(conveyor.z);var height:=float(conveyor.height);var size:=Vector3(float(conveyor.length),height,1.4) if str(conveyor.axis)=="x" else Vector3(1.4,height,float(conveyor.length));_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),size,Color("#6e6758"),"IndustrialConveyor")

func _add_industrial_gantry(root:Node3D,record:Dictionary)->void:
	var x:=float(record.x);var z:=float(record.z);var span:=float(record.span);var height:=float(record.height);var axis:=str(record.axis);var ground:=ground_height(root.global_position+Vector3(x,0.0,z));var offset:=span*.5
	_add_box(root,Vector3(x-offset,ground+height*.5,z),Vector3(.8,height,.8),Color("#9d9b71"),"IndustrialGantryPost") if axis=="x" else _add_box(root,Vector3(x,ground+height*.5,z-offset),Vector3(.8,height,.8),Color("#9d9b71"),"IndustrialGantryPost")
	_add_box(root,Vector3(x+offset,ground+height*.5,z),Vector3(.8,height,.8),Color("#9d9b71"),"IndustrialGantryPost") if axis=="x" else _add_box(root,Vector3(x,ground+height*.5,z+offset),Vector3(.8,height,.8),Color("#9d9b71"),"IndustrialGantryPost")
	_add_box(root,Vector3(x,ground+height,z),Vector3(span,.8,1.0) if axis=="x" else Vector3(1.0,.8,span),Color("#9d9b71"),"IndustrialGantryBeam")

func _add_industrial_pipe(root:Node3D,record:Dictionary)->void:
	var x:=float(record.x);var z:=float(record.z);var pipe:=MeshInstance3D.new();var mesh:=CylinderMesh.new();mesh.top_radius=float(record.radius);mesh.bottom_radius=float(record.radius);mesh.height=float(record.length);pipe.name="IndustrialPipe";pipe.mesh=mesh;pipe.position=Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(record.height),z);pipe.rotation.z=PI*.5 if str(record.axis)=="x" else 0.0;pipe.rotation.x=PI*.5 if str(record.axis)=="z" else 0.0;pipe.material_override=_material(Color("#6f746c"));root.add_child(pipe)

func _add_industrial_traversal(root:Node3D,fields:Dictionary)->void:
	for catwalk:Dictionary in fields.get("catwalks",[]):
		var x:=float(catwalk.x);var z:=float(catwalk.z);var size:=Vector3(float(catwalk.length),.45,float(catwalk.width)) if str(catwalk.axis)=="x" else Vector3(float(catwalk.width),.45,float(catwalk.length));_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(catwalk.height),z),size,Color("#89906e"),"IndustrialCatwalk")
	for access:Dictionary in fields.get("access_routes",[]):
		var count:=int(access.step_count);var axis:=str(access.axis);var direction:=float(access.direction)
		for step in range(count):
			var progress:=float(step+1)/float(count);var x:=float(access.x)-direction*float(access.run)*(1.0-progress) if axis=="x" else float(access.x);var z:=float(access.z)-direction*float(access.run)*(1.0-progress) if axis=="z" else float(access.z);var height:=float(access.rise)*progress;var size:=Vector3(float(access.run)/float(count),height,2.4) if axis=="x" else Vector3(2.4,height,float(access.run)/float(count));_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),size,Color("#7f7c67"),"IndustrialAccessStep")

func _add_industrial_hazards(root:Node3D,fields:Dictionary)->void:
	for field:Dictionary in fields.get("fields",[]):_add_hazard(root,field)

func _add_industrial_resources(root:Node3D,fields:Dictionary)->void:
	for resource:Dictionary in fields.get("resources",[]):_add_resource(root,resource)

func _add_natural_resources(root:Node3D,fields:Dictionary)->void:
	for resource:Dictionary in fields.get("resources",[]):_add_resource(root,resource)

func _add_suburb_roads(root:Node3D,fields:Dictionary)->void:
	var roads:Array=[fields.get("collector",{})]+fields.get("local_roads",[])
	for road:Dictionary in roads:
		if road.is_empty():continue
		var axis:=str(road.axis);var offset:=float(road.offset);var position:=Vector3(32.0,.02,offset) if axis=="x" else Vector3(offset,.02,32.0);position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(64.0,.05,float(road.width)) if axis=="x" else Vector3(float(road.width),.05,64.0);visual.name="SuburbRoad";visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#535950"));root.add_child(visual)
	for culdesac:Dictionary in fields.get("culdesacs",[]):
		var axis:=str(culdesac.axis);var x:=float(culdesac.x);var z:=float(culdesac.z);var segment:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(float(culdesac.length),.05,float(culdesac.width)) if axis=="x" else Vector3(float(culdesac.width),.05,float(culdesac.length));segment.name="SuburbCuldesacRoad";segment.mesh=mesh;segment.position=Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+.02,z);segment.material_override=_material(Color("#535950"));root.add_child(segment)
		var circle:=MeshInstance3D.new();var disk:=CylinderMesh.new();disk.top_radius=float(culdesac.radius);disk.bottom_radius=float(culdesac.radius);disk.height=.06;circle.name="SuburbCuldesac";circle.mesh=disk;circle.position=Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+.03,z);circle.material_override=_material(Color("#535950"));root.add_child(circle)

func _add_suburb_parcels(root:Node3D,fields:Dictionary,transitions:Dictionary)->void:
	var entries:Dictionary={}
	for entry:Dictionary in transitions.get("entries",[]):entries[str(entry.home_id)]=entry
	for yard:Dictionary in fields.get("yards",[]):
		var x:=float(yard.x);var z:=float(yard.z);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(float(yard.width),.04,float(yard.depth));visual.name="SuburbYard";visual.mesh=mesh;visual.position=Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+.02,z);visual.material_override=_material(Color("#617554"));root.add_child(visual)
	for home:Dictionary in fields.get("homes",[]):
		_add_suburb_home(root,home,entries.get(str(home.id),{}))
	for utility:Dictionary in fields.get("utilities",[]):
		var x:=float(utility.x);var z:=float(utility.z);var height:=float(utility.height);_add_cylinder(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5,z),.22,height,Color("#76745e"),"SuburbUtility")

func _add_suburb_home(root:Node3D,home:Dictionary,entry:Dictionary)->void:
	var x:=float(home.x);var z:=float(home.z);var width:=float(home.width);var depth:=float(home.depth);var height:=float(home.height);var ground:=ground_height(root.global_position+Vector3(x,0.0,z));var color:=Color("#586a57") if str(home.form)=="bungalow" else Color("#626b5a") if str(home.form)=="duplex" else Color("#6b6758");var side:=str(entry.get("side","north"));var door_width:=minf(float(entry.get("width",1.6)),(width if side in ["north","south"] else depth)-.6);var wall:=.4
	if side in ["north","south"]:
		var front_z:=z-depth*.5 if side=="north" else z+depth*.5;var back_z:=z+depth*.5 if side=="north" else z-depth*.5;var segment:=(width-door_width)*.5;var segment_offset:=door_width*.5+segment*.5;_add_box(root,Vector3(x-segment_offset,ground+height*.5,front_z),Vector3(segment,height,wall),color,"SuburbHomeWall");_add_box(root,Vector3(x+segment_offset,ground+height*.5,front_z),Vector3(segment,height,wall),color,"SuburbHomeWall");_add_box(root,Vector3(x,ground+height*.5,back_z),Vector3(width,height,wall),color,"SuburbHomeWall");_add_box(root,Vector3(x-width*.5,ground+height*.5,z),Vector3(wall,height,depth),color,"SuburbHomeWall");_add_box(root,Vector3(x+width*.5,ground+height*.5,z),Vector3(wall,height,depth),color,"SuburbHomeWall")
	else:
		var front_x:=x+width*.5 if side=="east" else x-width*.5;var back_x:=x-width*.5 if side=="east" else x+width*.5;var segment:=(depth-door_width)*.5;var segment_offset:=door_width*.5+segment*.5;_add_box(root,Vector3(front_x,ground+height*.5,z-segment_offset),Vector3(wall,height,segment),color,"SuburbHomeWall");_add_box(root,Vector3(front_x,ground+height*.5,z+segment_offset),Vector3(wall,height,segment),color,"SuburbHomeWall");_add_box(root,Vector3(back_x,ground+height*.5,z),Vector3(wall,height,depth),color,"SuburbHomeWall");_add_box(root,Vector3(x,ground+height*.5,z-depth*.5),Vector3(width,height,wall),color,"SuburbHomeWall");_add_box(root,Vector3(x,ground+height*.5,z+depth*.5),Vector3(width,height,wall),color,"SuburbHomeWall")
	_add_box(root,Vector3(x,ground+height+.2,z),Vector3(width+.4,.4,depth+.4),color,"SuburbHomeRoof")

func _add_suburb_transitions(root:Node3D,fields:Dictionary)->void:
	for entry:Dictionary in fields.get("entries",[]):
		var side:=str(entry.side);var normal:=Vector3(0.0,0.0,-1.0) if side=="north" else Vector3(1.0,0.0,0.0) if side=="east" else Vector3(0.0,0.0,1.0) if side=="south" else Vector3(-1.0,0.0,0.0);var x:=float(entry.x);var z:=float(entry.z);var depth:=float(entry.porch_depth);var width:=float(entry.width)+.8;var porch_x:=x+normal.x*depth*.5;var porch_z:=z+normal.z*depth*.5;var size:=Vector3(width,.3,depth) if side in ["north","south"] else Vector3(depth,.3,width);_add_box(root,Vector3(porch_x,ground_height(root.global_position+Vector3(porch_x,0.0,porch_z))+.15,porch_z),size,Color("#747660"),"SuburbPorch")
		for step in range(2):
			var step_x:=x+normal.x*(depth+float(step)*.8);var step_z:=z+normal.z*(depth+float(step)*.8);var height:=.22-float(step)*.07;var step_size:=Vector3(width,height,.8) if side in ["north","south"] else Vector3(.8,height,width);_add_box(root,Vector3(step_x,ground_height(root.global_position+Vector3(step_x,0.0,step_z))+height*.5,step_z),step_size,Color("#747660"),"SuburbPorchStep")

func _add_suburb_traversal(root:Node3D,fields:Dictionary)->void:
	for root_record:Dictionary in fields.get("roots",[]):
		var x:=float(root_record.x);var z:=float(root_record.z);var size:=Vector3(float(root_record.length),float(root_record.height),float(root_record.width)) if str(root_record.axis)=="x" else Vector3(float(root_record.width),float(root_record.height),float(root_record.length));_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(root_record.height)*.5,z),size,Color("#665d45"),"SuburbRoot")
	for canopy:Dictionary in fields.get("canopies",[]):
		var x:=float(canopy.x);var z:=float(canopy.z);var ground:=ground_height(root.global_position+Vector3(x,0.0,z));_add_tree(root,Vector3(x,ground,z),float(canopy.trunk_height),Color("#466c43"));_add_box(root,Vector3(x,ground+float(canopy.trunk_height),z),Vector3(float(canopy.platform_width),.35,float(canopy.platform_depth)),Color("#557747"),"SuburbCanopy")
	for collapse:Dictionary in fields.get("collapses",[]):
		var x:=float(collapse.x);var z:=float(collapse.z);var size:=Vector3(float(collapse.length),float(collapse.height),1.4) if str(collapse.axis)=="x" else Vector3(1.4,float(collapse.height),float(collapse.length));_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(collapse.height)*.5,z),size,Color("#705d4c"),"SuburbCollapse")

func _add_suburb_resources(root:Node3D,fields:Dictionary)->void:
	for resource:Dictionary in fields.get("resources",[]):_add_resource(root,resource)

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
	var x:=float(record.local_x);var z:=float(record.local_z)
	_add_resource_at(root,record,x,z,ground_height(root.global_position+Vector3(x,0.0,z))+1.1)

func _add_resource_at(root:Node3D,record:Dictionary,x:float,z:float,y:float)->void:
	var kind:=str(record.kind)
	var pickup = RESOURCE_PICKUP.new()
	pickup.name = kind.capitalize() + "Pickup"
	pickup.set_meta("resource_id",str(record.id))
	pickup.kind = kind
	pickup.position = Vector3(x,y,z)
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

func _add_city_rooftop_resources(root:Node3D,ecology:Dictionary)->void:
	for resource:Dictionary in ecology.get("resources",[]):
		var x:=float(resource.x);var z:=float(resource.z);_add_resource_at(root,resource,x,z,ground_height(root.global_position+Vector3(x,0.0,z))+float(resource.roof_height)+1.1)

func _add_city_vegetation(root:Node3D,ecology:Dictionary)->void:
	for record:Dictionary in ecology.get("vegetation",[]):
		var x:=float(record.x);var z:=float(record.z);var color:=Color("#688a55") if str(record.stage)=="pioneer" else Color("#4f7b4b") if str(record.stage)=="shrub" else Color("#3f703f");_add_tree(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+float(record.base_height),z),float(record.height),color)

func _add_flooded_city_routes(root:Node3D,routes:Dictionary)->void:
	for canal:Dictionary in routes.get("canals",[]):
		var axis:=str(canal.axis);var offset:=float(canal.offset);var position:=Vector3(32.0,.02,offset) if axis=="x" else Vector3(offset,.02,32.0);position.y+=ground_height(root.global_position+position);var visual:=MeshInstance3D.new();var mesh:=BoxMesh.new();mesh.size=Vector3(64.0,.04,float(canal.width)) if axis=="x" else Vector3(float(canal.width),.04,64.0);visual.mesh=mesh;visual.position=position;visual.material_override=_material(Color("#315f73"));root.add_child(visual)
	for bridge:Dictionary in routes.get("bridges",[]):
		var axis:=str(bridge.axis);var position:=Vector3(float(bridge.offset),float(bridge.height),float(bridge.canal_offset)) if axis=="z" else Vector3(float(bridge.canal_offset),float(bridge.height),float(bridge.offset));position.y+=ground_height(root.global_position+Vector3(position.x,0.0,position.z));_add_box(root,position,Vector3(2.6,.6,float(bridge.length)) if axis=="z" else Vector3(float(bridge.length),.6,2.6),Color("#718072"),"FloodBridge")
	for roof:Dictionary in routes.get("roof_routes",[]):
		var axis:=str(roof.axis);var position:=Vector3(32.0,float(roof.height),float(roof.offset)) if axis=="x" else Vector3(float(roof.offset),float(roof.height),32.0);position.y+=ground_height(root.global_position+Vector3(position.x,0.0,position.z));_add_box(root,position,Vector3(float(roof.length),.5,2.4) if axis=="x" else Vector3(2.4,.5,float(roof.length)),Color("#668c82"),"FloodRoofRoute")

func _add_flooded_city_structures(root:Node3D,fields:Dictionary)->void:
	for structure:Dictionary in fields.get("structures",[]):
		var x:=float(structure.x);var z:=float(structure.z);var height:=maxf(1.5,float(structure.height)*float(structure.height_scale)-float(structure.submerged_depth)*.4);var color:=Color("#47646a") if str(structure.collapse)=="standing" else Color("#5b5f58")
		_add_box(root,Vector3(x,ground_height(root.global_position+Vector3(x,0.0,z))+height*.5-float(structure.submerged_depth)*.12,z),Vector3(float(structure.width),height,float(structure.depth)),color,"FloodStructure")

func _add_flooded_city_ecology(root:Node3D,ecology:Dictionary)->void:
	for resource:Dictionary in ecology.get("resources",[]):
		var x:=float(resource.local_x);var z:=float(resource.local_z);_add_resource_at(root,resource,x,z,ground_height(root.global_position+Vector3(x,0.0,z))+float(resource.support_height)+1.1)
	for hazard:Dictionary in ecology.get("hazards",[]):_add_hazard(root,hazard)

func _add_hazard(root:Node3D,record:Dictionary)->void:
	var hazard:=Node3D.new();hazard.name="Hazard_"+str(record.id).replace(":","_");hazard.add_to_group("hazard");hazard.set_meta("hazard_id",str(record.id));hazard.set_meta("kind",str(record.kind))
	if record.has("source"):hazard.set_meta("source",str(record.source))
	if record.has("intensity"):hazard.set_meta("intensity",float(record.intensity))
	hazard.position=Vector3(float(record.local_x),ground_height(root.global_position+Vector3(float(record.local_x),0.0,float(record.local_z)))+.06,float(record.local_z))
	var marker:=MeshInstance3D.new();var mesh:=CylinderMesh.new();var radius:=float(record.get("radius",2.2));mesh.top_radius=radius;mesh.bottom_radius=radius;mesh.height=.12;marker.mesh=mesh
	var color:=Color("#8c7a43")
	if str(record.kind)=="contamination":color=Color("#9b6a37")
	elif str(record.kind)=="floodwater":color=Color("#4d8c9d")
	elif str(record.kind)=="current":color=Color("#3a7b90")
	elif str(record.kind)=="deep_water":color=Color("#274e67")
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

func _add_cylinder(root:Node3D,position:Vector3,radius:float,height:float,color:Color,node_name:String)->void:
	var body:=StaticBody3D.new();body.name=node_name;body.position=position
	var visual:=MeshInstance3D.new();var cylinder:=CylinderMesh.new();cylinder.top_radius=radius;cylinder.bottom_radius=radius;cylinder.height=height;visual.mesh=cylinder;visual.material_override=_material(color);body.add_child(visual)
	var collision:=CollisionShape3D.new();var shape:=CylinderShape3D.new();shape.radius=radius;shape.height=height;collision.shape=shape;body.add_child(collision);root.add_child(body)

func _terrain_material(biome: String, family: String) -> StandardMaterial3D:
	var material := _material(REGION_PRESENTATION.palette(biome,family).terrain).duplicate() as StandardMaterial3D
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material

func _interior_material() -> StandardMaterial3D:
	var material := _material(Color("#535b52")).duplicate() as StandardMaterial3D
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material

func _silhouette_material(biome: String, family: String) -> StandardMaterial3D:
	var material := _material(REGION_PRESENTATION.palette(biome,family).silhouette).duplicate() as StandardMaterial3D
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _material(color: Color, emissive := false) -> StandardMaterial3D:
	var key:=color.to_html(true)+":"+str(emissive)
	if material_cache.has(key):return material_cache[key] as StandardMaterial3D
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.9
	if emissive:
		material.emission_enabled = true
		material.emission = color
	material_cache[key]=material
	return material

func _chunk_id(x: int, z: int) -> String:
	return "%d:%d" % [x, z]
