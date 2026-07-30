class_name WorldClimateBands
extends RefCounted

const DEFAULT_CIRCUMFERENCE := 4194304.0
const DEFAULT_OMEGA := 7.2921e-5

var seed: int
var world_circumference: float
var omega: float
var legacy_latitude: bool
var geologic_time: float
var season_rate: float
var itcz_offset_amp: float
var wind_coriolis_scale: float
var climate_bands: Array

func _init(next_seed: int, options: Dictionary = {}) -> void:
	seed = next_seed; world_circumference = float(options.get("world_circumference", DEFAULT_CIRCUMFERENCE)); omega = float(options.get("omega", DEFAULT_OMEGA)); legacy_latitude = bool(options.get("legacy_latitude", false)); geologic_time = float(options.get("geologic_time", 0.0)); season_rate = float(options.get("season_rate", 1.0)); itcz_offset_amp = float(options.get("itcz_offset_amp", 0.17)); wind_coriolis_scale = float(options.get("wind_coriolis_scale", 0.22))
	assert(world_circumference > 0.0 and season_rate > 0.0, "latitude circumference and season rate must be positive")
	climate_bands = build_bands()

func geographic_latitude_at(world_z: float) -> float:
	var unit := world_z / world_circumference; var wrapped := 2.0 * absf(unit - floorf(unit + 0.5)); var phase := fposmod(unit + 0.5, 1.0) - 0.5
	return (1.0 - wrapped) * PI * 0.5 * (1.0 if phase >= 0.0 else -1.0)

func latitude_at(world_z: float) -> float:
	return legacy_latitude_for(seed, world_z) if legacy_latitude else geographic_latitude_at(world_z)

func coriolis_at(world_z: float) -> float: return 2.0 * omega * sin(geographic_latitude_at(world_z))
func build_bands() -> Array:
	var bands: Array = []
	for index in range(181): bands.append(band_for_latitude(-PI * 0.5 + float(index) * PI / 180.0))
	return bands
func band_at(world_z: float) -> Dictionary:
	var index := clampi(floori((latitude_at(world_z) + PI * 0.5) / PI * 180.0 + 0.5), 0, climate_bands.size() - 1)
	return (climate_bands[index] as Dictionary).duplicate()
func wind_at(world_z: float) -> Vector2:
	var band := band_at(world_z)
	return Vector2(float(band.wind_x), float(band.wind_y))
func band_for_latitude(latitude_radians: float) -> Dictionary:
	var absolute := absf(latitude_radians); var sign := 1.0 if latitude_radians >= 0.0 else -1.0; var itcz := itcz_offset_amp * _season_phase(); var distance := absf(latitude_radians - itcz)
	var zonal := 0.0; var meridional := 0.0; var precipitation := 0.0; var pressure := 0
	if distance < deg_to_rad(10.0): zonal = -0.35; meridional = -0.55 if latitude_radians > itcz else 0.55; precipitation = 0.62; pressure = 3
	elif absolute < deg_to_rad(20.0): zonal = -0.82; meridional = -0.32 if latitude_radians > itcz else 0.32; precipitation = 0.50; pressure = 0
	elif absolute < deg_to_rad(35.0): zonal = -0.92; meridional = 0.08 * sign; precipitation = 0.12; pressure = 1
	elif absolute < deg_to_rad(50.0): zonal = 0.90; meridional = 0.12 * sign; precipitation = 0.42; pressure = 2
	elif absolute < deg_to_rad(60.0): zonal = 0.72; meridional = -0.18 * sign; precipitation = 0.52; pressure = 5
	else: zonal = -0.72; meridional = -0.10 * sign; precipitation = 0.18; pressure = 6
	var wind := _rotate(zonal, meridional, atan(sin(latitude_radians) * wind_coriolis_scale)); var normalized := _normalize(wind.x, wind.y)
	return {"latitude_radians": latitude_radians, "wind_x": normalized.x, "wind_y": normalized.y, "baseline_precip": precipitation, "pressure_cell_id": pressure}

static func legacy_latitude_for(seed: int, world_z: float) -> float: return sin(world_z * 0.00045 + float(seed) * 0.0001) * PI * 0.5
static func geographic_latitude_for(world_z: float, circumference: float = DEFAULT_CIRCUMFERENCE) -> float:
	var unit := world_z / circumference; var wrapped := 2.0 * absf(unit - floorf(unit + 0.5)); var phase := fposmod(unit + 0.5, 1.0) - 0.5
	return (1.0 - wrapped) * PI * 0.5 * (1.0 if phase >= 0.0 else -1.0)
func _season_phase() -> float: return sin(TAU * (geologic_time / maxf(0.000001, season_rate)))
static func _normalize(x: float, z: float) -> Vector2:
	var length := sqrt(x * x + z * z)
	return Vector2(1.0, 0.0) if length <= 0.0 else Vector2(x / length, z / length)
static func _rotate(x: float, z: float, angle: float) -> Vector2: return Vector2(x * cos(angle) - z * sin(angle), x * sin(angle) + z * cos(angle))
