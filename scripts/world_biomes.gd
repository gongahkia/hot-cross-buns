class_name WorldBiomes
extends RefCounted

static func terrestrial(temperature: float, precipitation: float) -> String:
	if temperature < 0.12 and precipitation < 0.18: return "polar_desert"
	if temperature < 0.2: return "boreal_forest" if precipitation > 0.52 else "tundra"
	if temperature < 0.48 and precipitation < 0.18: return "cold_desert"
	if temperature < 0.34 and precipitation > 0.68: return "muskeg"
	if temperature < 0.38: return "tundra" if precipitation < 0.28 else "grassland" if precipitation < 0.54 else "boreal_forest"
	if temperature < 0.62 and precipitation > 0.76: return "temperate_rainforest"
	if temperature < 0.62: return "cold_desert" if precipitation < 0.18 else "desert" if precipitation < 0.24 else "semiarid_shrubland" if precipitation < 0.34 else "grassland" if precipitation < 0.48 else "temperate_forest"
	return "desert" if precipitation < 0.2 else "thorn_scrub" if precipitation < 0.32 else "savanna" if precipitation < 0.42 else "dry_broadleaf" if precipitation < 0.58 else "monsoon_forest" if precipitation < 0.74 else "rainforest"
static func lookup(temperature: float, precipitation: float, elevation: float, water: bool, slope: float, hotspot: float, flood_basalt: bool, karst_type: int, reef_stage: int, allow_exotic: bool, cell: Dictionary = {}) -> String:
	var heat := clampf(temperature, 0.0, 1.0); var rain := clampf(precipitation, 0.0, 1.0)
	if reef_stage == 4: return "lagoon"
	if reef_stage == 2: return "atoll_ring"
	if reef_stage == 1: return "seamount_cap"
	if reef_stage == 3: return "reef"
	if water: return "mangrove" if elevation > -0.035 and heat > 0.62 and rain > 0.52 else "kelp_forest_fringe" if elevation > -0.06 and heat < 0.48 else "coast" if elevation > -0.06 else "seamount_cap" if elevation > -0.12 and heat > 0.6 else "atoll_ring" if elevation > -0.2 and heat > 0.62 and rain > 0.66 else "ocean"
	if flood_basalt: return "lava_flow"
	if karst_type > 0: return "karst"
	if allow_exotic and heat > 0.74 and rain > 0.88 and elevation < 0.22: return "bioluminescent_grove"
	if allow_exotic and heat < 0.16 and elevation > 0.62: return "blue_ice_field"
	if allow_exotic and rain < 0.1 and elevation < 0.22 and slope < 0.04: return "salt_cathedral"
	if hotspot > 0.25 and slope < 0.2: return "shield"
	if int(cell.get("volcanic_form", 0)) == 2 and rain > 0.44: return "hot_spring_travertine"
	if int(cell.get("volcanic_form", 0)) > 0 and rain < 0.28: return "ash_plain"
	if hotspot > 0.18 and slope < 0.12 and heat > 0.42: return "fumarole_field"
	if int(cell.get("periglacial_feature", 0)) == 3: return "permafrost_polygon"
	if elevation > 0.86 and heat < 0.28: return "nival_zone"
	if elevation > 0.64 and slope > 0.16 and heat < 0.48: return "alpine_scree"
	if elevation > 0.72: return "snow" if heat < 0.35 else "rock"
	if slope > 0.18 and elevation > 0.45: return "subalpine_krummholz" if heat < 0.42 else "alpine"
	if elevation > 0.36 and heat > 0.58 and rain > 0.74: return "cloud_forest"
	if heat < 0.14 and rain >= 0.18: return "snow"
	if rain > 0.82 and elevation < 0.12: return "wetland"
	if not cell.is_empty() and (bool(cell.get("playa", false)) or (rain < 0.12 and slope < 0.04 and elevation < 0.16)): return "playa_salt_flat"
	if rain < 0.28 and slope > 0.16 and elevation > 0.12: return "badland"
	return terrestrial((floori(heat * 16.0) + 0.5) / 16.0, (floori(rain * 16.0) + 0.5) / 16.0)
static func refine(cell: Dictionary, allow_exotic: bool = false) -> String:
	cell["treeline"] = 0; cell["riparian"] = 0; cell["fire_frequency"] = 0.0; cell.erase("biome_secondary")
	if bool(cell.get("water", false)): return str(cell.get("biome", ""))
	var exotic := allow_exotic or bool(cell.get("allow_exotic_biomes", false)); var heat := clampf(float(cell.get("temperature", 0.5)), 0.0, 1.0); var rain := clampf(float(cell.get("rainfall", cell.get("precipitation", cell.get("moisture", 0.5)))), 0.0, 1.0); var elevation := float(cell.get("elevation", cell.get("elevation_base", 0.0))); var slope := float(cell.get("slope", 0.0)); var latitude := _latitude(cell)
	var biome := str(cell.get("biome", lookup(heat, rain, elevation, false, slope, float(cell.get("hotspot_contribution", 0.0)), bool(cell.get("is_flood_basalt", false)), int(cell.get("karst_type", 0)), int(cell.get("reef_stage", 0)), exotic, cell)))
	if elevation > 0.38 and (heat * (1.0 - latitude) * 4000.0 < 1100.0 or Vector2(float(cell.get("wind_x", 0.0)), float(cell.get("wind_y", 0.0))).length() > 0.9) and _forest(biome): cell["treeline"] = 1; biome = "tundra" if heat < 0.3 else "subalpine_krummholz"
	if bool(cell.get("river_bank", false)): cell["riparian"] = 1; biome = "oasis" if rain < 0.22 else "riparian_gallery_forest" if rain < 0.34 and biome in ["desert", "grassland", "savanna", "thorn_scrub", "semiarid_shrubland"] else biome
	var summer_dry := latitude * 90.0 >= 25.0 and latitude * 90.0 <= 45.0 and float(cell.get("monsoon_index", 0.0)) < 0.15 and heat > 0.42
	if summer_dry:
		cell["fire_frequency"] = clampf((0.58-rain)*1.6+(heat-0.42)*0.35,0.0,1.0)
		if float(cell.fire_frequency)>0.3 and _forest(biome): biome="savanna" if heat>0.6 else "mediterranean_chaparral"
	if float(cell.get("dune_amplitude",0.0))>0.02 and biome in ["desert","thorn_scrub"]: biome="dune_sea_erg"
	if (bool(cell.get("coast_beach",false)) or bool(cell.get("delta",false))) and heat>0.66 and rain>0.55: biome="mangrove"
	if biome in ["monsoon_forest","rainforest","temperate_forest"]: biome="cloud_forest" if elevation>0.32 and rain>0.62 else "dry_broadleaf" if float(cell.get("rain_shadow_score",0.0))>0.18 and heat>0.58 else "mixed_forest" if int(cell.get("lithology",0))==6 and rain>0.48 else "conifer_forest" if slope>0.14 and elevation>0.18 else biome
	if biome=="savanna" and rain<0.3: biome="thorn_scrub"
	if biome=="grassland" and rain<0.34: biome="semiarid_shrubland"
	if exotic and bool(cell.get("coast_beach",false)) and heat>0.62 and rain>0.52: biome="red_algal_shore"
	if exotic and biome=="snow" and elevation>0.72 and heat<0.2: biome="blue_ice_field"
	if biome not in ["ocean","coast","river","lake"]:
		var warm:=terrestrial(clampf(heat+0.05,0.0,1.0),rain); var wet:=terrestrial(heat,clampf(rain+0.08,0.0,1.0))
		if warm!=biome: cell["biome_secondary"]=warm
		elif wet!=biome: cell["biome_secondary"]=wet
	cell["biome"] = biome; return biome
static func _latitude(cell: Dictionary) -> float: return minf(1.0,absf(float(cell.get("latitude_radians",0.0)))/(PI*0.5))
static func _forest(biome: String) -> bool: return biome in ["temperate_forest","rainforest","boreal_forest","temperate_rainforest","cloud_forest","monsoon_forest","dry_broadleaf","mixed_forest","conifer_forest"]
