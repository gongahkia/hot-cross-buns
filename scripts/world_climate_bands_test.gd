extends SceneTree
const BANDS = preload("res://scripts/world_climate_bands.gd")
const EPSILON := 0.000001
var failed := false

func _initialize() -> void:
	var climate := BANDS.new(20260730)
	_expect(absf(climate.geographic_latitude_at(0.0) - PI * 0.5) <= EPSILON and absf(climate.geographic_latitude_at(2097152.0)) <= EPSILON and absf(climate.coriolis_at(0.0) - 0.000145842) <= EPSILON, "geographic latitude/coriolis drifted")
	var equator := climate.band_for_latitude(0.0); var subtropic := climate.band_for_latitude(deg_to_rad(30.0)); var polar := climate.band_for_latitude(deg_to_rad(70.0))
	_expect(climate.climate_bands.size() == 181 and int(equator.pressure_cell_id) == 3 and int(subtropic.pressure_cell_id) == 1 and int(polar.pressure_cell_id) == 6, "climate pressure-band drifted")
	_expect(absf(Vector2(float(equator.wind_x), float(equator.wind_y)).length() - 1.0) <= EPSILON and climate.band_at(0.0) == climate.band_at(0.0), "climate wind determinism drifted")
	var legacy := BANDS.new(20260730, {"legacy_latitude": true})
	_expect(absf(legacy.latitude_at(1234.0) - BANDS.legacy_latitude_for(20260730, 1234.0)) <= EPSILON, "legacy latitude compatibility drifted")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
