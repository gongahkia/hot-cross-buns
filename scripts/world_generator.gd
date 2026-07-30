class_name WorldGenerator
extends RefCounted

const RNG := preload("res://scripts/world_rng.gd")
const SCALE := preload("res://scripts/world_scale.gd")
const URBAN_FIELDS := preload("res://scripts/world_urban_fields.gd")
const CITY_LAYOUT := preload("res://scripts/world_reclaimed_city_layout.gd")
const CITY_ARTERIALS := preload("res://scripts/world_city_arterials.gd")
const CITY_SECONDARY_ROADS := preload("res://scripts/world_city_secondary_roads.gd")
const CITY_PARCELS := preload("res://scripts/world_city_parcels.gd")
const CITY_MASSING := preload("res://scripts/world_city_massing.gd")
const CITY_TRAVERSAL := preload("res://scripts/world_city_traversal.gd")
const CITY_FAILURES := preload("res://scripts/world_city_failures.gd")
const CITY_ROOFTOP_RESOURCES := preload("res://scripts/world_city_rooftop_resources.gd")
const CITY_VEGETATION := preload("res://scripts/world_city_vegetation.gd")
const FLOODED_BASIN := preload("res://scripts/world_flooded_city_basin.gd")
const FLOODED_INUNDATION := preload("res://scripts/world_flooded_city_inundation.gd")

const CHUNK_SIZE := 64.0
const REGION_SIZE := 512.0
const SEA_LEVEL := 0.0
const URBAN_FAMILIES := ["reclaimed_city", "flooded_city", "industrial_ruin", "overgrown_suburb"]
const NATURAL_BIOMES := ["ocean", "coast", "lake", "river", "wetland", "desert", "cold_desert", "polar_desert", "semiaird_shrubland", "playa_salt_flat", "dune_sea_erg", "badland", "oasis", "grassland", "savanna", "temperate_forest", "temperate_rainforest", "mixed_forest", "conifer_forest", "rainforest", "monsoon_forest", "dry_broadleaf", "cloud_forest", "thorn_scrub", "mediterranean_chaparral", "mangrove", "riparian_gallery_forest", "boreal_forest", "muskeg", "subalpine_krummholz", "tundra", "permafrost_polygon", "alpine", "alpine_scree", "nival_zone", "snow", "rock", "lava_flow", "shield", "karst", "reef", "lagoon", "kelp_forest_fringe", "atoll_ring", "seamount_cap", "fumarole_field", "hot_spring_travertine", "ash_plain"]

var seed: int

func _init(next_seed: int) -> void:
	seed = next_seed

func region_at(world_position: Vector3) -> Dictionary:
	var rx := floori(world_position.x / REGION_SIZE)
	var rz := floori(world_position.z / REGION_SIZE)
	var roll := RNG.unit(seed, rx, rz, 71)
	var family := "wilderness"
	if roll < 0.16:
		family = "reclaimed_city"
	elif roll < 0.30:
		family = "flooded_city"
	elif roll < 0.44:
		family = "industrial_ruin"
	elif roll < 0.58:
		family = "overgrown_suburb"
	var landmark_roll := RNG.unit(seed, rx, rz, 73)
	var landmark := ""
	if landmark_roll > 0.84:
		landmark = ["weather station", "collapsed observatory", "radio mast", "floodgate", "wind farm", "glass conservatory"][RNG.hash_int(seed, rx, rz, 79) % 6]
	return {"x": rx, "z": rz, "id": "%d:%d" % [rx, rz], "family": family, "landmark": landmark, "name": _region_name(rx, rz, family)}

static func scale_info(scope: Variant = "local") -> Dictionary:
	return SCALE.info(scope)

func sample(world_x: float, world_z: float, scope: Variant = "local") -> Dictionary:
	var scale: Dictionary = SCALE.info(scope)
	var sample_x := SCALE.coordinate(world_x, scale.get("id", "local"))
	var sample_z := SCALE.coordinate(world_z, scale.get("id", "local"))
	var continental := RNG.fbm(seed, sample_x / 900.0, sample_z / 900.0, 5, 11) * 7.0
	var relief := absf(RNG.fbm(seed, sample_x / 170.0, sample_z / 170.0, 4, 29)) * 15.0
	var detail := RNG.fbm(seed, sample_x / 42.0, sample_z / 42.0, 4, 47) * 2.4
	var plate := RNG.fbm(seed, sample_x / 1500.0, sample_z / 1500.0, 3, 61)
	var elevation := continental + relief * smoothstep(0.08, 0.62, absf(plate)) + detail - 1.6
	var region := region_at(Vector3(sample_x, 0.0, sample_z))
	if region.family == "flooded_city": elevation -= 4.2
	if region.family == "industrial_ruin": elevation += 0.5
	var temperature := clampf(0.58 - absf(RNG.fbm(seed, sample_x / 3000.0, sample_z / 3000.0, 2, 89)) * 0.42 - elevation * 0.018, 0.0, 1.0)
	var rainfall := clampf(0.52 + RNG.fbm(seed, sample_x / 1200.0, sample_z / 1200.0, 4, 101) * 0.38, 0.0, 1.0)
	var biome := _biome(elevation, temperature, rainfall, region.family)
	return {"elevation": elevation, "temperature": temperature, "rainfall": rainfall, "biome": biome, "region": region, "water": elevation <= SEA_LEVEL, "scale": scale.id, "scale_factor": scale.factor, "sample_x": sample_x, "sample_z": sample_z}

func chunk_descriptor(chunk_x: int, chunk_z: int, scope: Variant = "local") -> Dictionary:
	var scale: Dictionary = SCALE.info(scope)
	var center := Vector3(SCALE.chunk_center(chunk_x, CHUNK_SIZE, scale.id), 0.0, SCALE.chunk_center(chunk_z, CHUNK_SIZE, scale.id))
	var sample_data := sample(center.x, center.z, scale.id)
	var descriptor:Dictionary={"x": chunk_x, "z": chunk_z, "id": "%d:%d" % [chunk_x, chunk_z], "center": center, "region": sample_data.region, "biome": sample_data.biome, "water": sample_data.water, "scale": scale.id, "scale_factor": scale.factor}
	var urban:=URBAN_FIELDS.sample(seed,chunk_x,chunk_z,str(sample_data.region.family))
	if not urban.is_empty():descriptor["urban"]=urban
	var city_layout:=CITY_LAYOUT.sample(self,chunk_x,chunk_z,sample_data)
	if not city_layout.is_empty():descriptor["city_layout"]=city_layout
	var city_arterials:=CITY_ARTERIALS.generate(seed,chunk_x,chunk_z,city_layout)
	if not city_arterials.is_empty():descriptor["city_arterials"]=city_arterials
	var city_secondary_roads:=CITY_SECONDARY_ROADS.generate(seed,chunk_x,chunk_z,city_arterials,urban)
	if not city_secondary_roads.is_empty():descriptor["city_secondary_roads"]=city_secondary_roads
	var city_parcels:=CITY_PARCELS.generate(seed,chunk_x,chunk_z,city_arterials,city_secondary_roads,urban)
	if not city_parcels.is_empty():descriptor["city_parcels"]=city_parcels
	var city_buildings:=CITY_MASSING.generate(seed,chunk_x,chunk_z,city_parcels,urban)
	if not city_buildings.is_empty():descriptor["city_buildings"]=city_buildings
	var city_traversal:=CITY_TRAVERSAL.generate(seed,chunk_x,chunk_z,city_buildings)
	if not city_traversal.is_empty():descriptor["city_traversal"]=city_traversal
	var city_failures:=CITY_FAILURES.generate(seed,chunk_x,chunk_z,city_buildings,urban)
	if not city_failures.is_empty():descriptor["city_failures"]=city_failures
	var city_rooftop_resources:=CITY_ROOFTOP_RESOURCES.generate(seed,chunk_x,chunk_z,city_buildings,city_failures,urban)
	if not city_rooftop_resources.is_empty():descriptor["city_rooftop_resources"]=city_rooftop_resources
	var city_vegetation:=CITY_VEGETATION.generate(seed,chunk_x,chunk_z,city_buildings,city_failures,urban)
	if not city_vegetation.is_empty():descriptor["city_vegetation"]=city_vegetation
	var flood_basin:=FLOODED_BASIN.sample(self,chunk_x,chunk_z,sample_data)
	if not flood_basin.is_empty():descriptor["flood_basin"]=flood_basin
	var flood_inundation:=FLOODED_INUNDATION.generate(seed,chunk_x,chunk_z,flood_basin)
	if not flood_inundation.is_empty():descriptor["flood_inundation"]=flood_inundation
	return descriptor

func _biome(elevation: float, temperature: float, rainfall: float, family: String) -> String:
	if family == "flooded_city": return "lagoon" if elevation < -2.5 else "wetland"
	if family != "wilderness": return "temperate_forest" if rainfall > 0.46 else "grassland"
	if elevation <= SEA_LEVEL - 3.0: return "ocean"
	if elevation <= SEA_LEVEL: return "coast"
	if elevation > 16.0: return "nival_zone" if temperature < 0.3 else "alpine"
	if elevation > 10.0: return "alpine_scree" if rainfall < 0.38 else "subalpine_krummholz"
	if temperature < 0.18: return "polar_desert" if rainfall < 0.30 else "tundra"
	if temperature < 0.35: return "boreal_forest" if rainfall > 0.42 else "cold_desert"
	if rainfall < 0.18: return "dune_sea_erg" if temperature > 0.62 else "badland"
	if rainfall < 0.31: return "thorn_scrub" if temperature > 0.62 else "grassland"
	if rainfall > 0.76: return "rainforest" if temperature > 0.67 else "temperate_rainforest"
	if rainfall > 0.57: return "temperate_forest"
	return "savanna" if temperature > 0.67 else "mixed_forest"

func _region_name(rx: int, rz: int, family: String) -> String:
	var first: String = ["Ash", "Cedar", "Glass", "Moss", "North", "Quiet", "Rust", "Tide"][RNG.hash_int(seed, rx, rz, 107) % 8]
	var second: String = {"reclaimed_city": "District", "flooded_city": "Basin", "industrial_ruin": "Works", "overgrown_suburb": "Estate", "wilderness": "Wilds"}.get(family, "Wilds")
	return first + " " + second
