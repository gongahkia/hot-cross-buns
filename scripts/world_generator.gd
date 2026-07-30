class_name WorldGenerator
extends RefCounted

const RNG := preload("res://scripts/world_rng.gd")

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

func sample(world_x: float, world_z: float) -> Dictionary:
	var continental := RNG.fbm(seed, world_x / 900.0, world_z / 900.0, 5, 11) * 7.0
	var relief := absf(RNG.fbm(seed, world_x / 170.0, world_z / 170.0, 4, 29)) * 15.0
	var detail := RNG.fbm(seed, world_x / 42.0, world_z / 42.0, 4, 47) * 2.4
	var plate := RNG.fbm(seed, world_x / 1500.0, world_z / 1500.0, 3, 61)
	var elevation := continental + relief * smoothstep(0.08, 0.62, absf(plate)) + detail - 1.6
	var region := region_at(Vector3(world_x, 0.0, world_z))
	if region.family == "flooded_city": elevation -= 4.2
	if region.family == "industrial_ruin": elevation += 0.5
	var temperature := clampf(0.58 - absf(RNG.fbm(seed, world_x / 3000.0, world_z / 3000.0, 2, 89)) * 0.42 - elevation * 0.018, 0.0, 1.0)
	var rainfall := clampf(0.52 + RNG.fbm(seed, world_x / 1200.0, world_z / 1200.0, 4, 101) * 0.38, 0.0, 1.0)
	var biome := _biome(elevation, temperature, rainfall, region.family)
	return {"elevation": elevation, "temperature": temperature, "rainfall": rainfall, "biome": biome, "region": region, "water": elevation <= SEA_LEVEL}

func chunk_descriptor(chunk_x: int, chunk_z: int) -> Dictionary:
	var center := Vector3((float(chunk_x) + 0.5) * CHUNK_SIZE, 0.0, (float(chunk_z) + 0.5) * CHUNK_SIZE)
	var sample_data := sample(center.x, center.z)
	return {"x": chunk_x, "z": chunk_z, "id": "%d:%d" % [chunk_x, chunk_z], "center": center, "region": sample_data.region, "biome": sample_data.biome, "water": sample_data.water}

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
