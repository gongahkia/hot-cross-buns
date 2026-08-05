class_name WorldClimate
extends RefCounted

const NOISE = preload("res://scripts/world_noise.gd")
const BANDS = preload("res://scripts/world_climate_bands.gd")

static func solve_region(bands, region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var cells := _cells(region); var land_fractions := _row_land_fractions(cells); var seasonal := sin(TAU * (float(options.get("geologic_time", bands.geologic_time)) / maxf(0.000001, float(options.get("season_rate", bands.season_rate)))))
	var by_key := {}; var sort_keys := {}
	for cell: Dictionary in cells:
		var cell_key := _key(_gx(cell), _gy(cell)); var band: Dictionary = bands.band_at(float(cell.get("y", _gy(cell))))
		by_key[cell_key] = band; sort_keys[cell_key] = float(_gx(cell)) * float(band.wind_x) + float(_gy(cell)) * float(band.wind_y); cell["incoming_moisture"] = 0.0; cell["incoming_moisture_count"] = 0
	cells.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ap := float(sort_keys[_key(_gx(a), _gy(a))]); var bp := float(sort_keys[_key(_gx(b), _gy(b))])
		if ap == bp: return _gx(a) < _gx(b) if _gy(a) == _gy(b) else _gy(a) < _gy(b)
		return ap < bp
	)
	var max_precipitation := 0.0; var shadow_cells := 0; var grid: Dictionary = region.get("cells", {}); var samples: Dictionary = options.get("sample_store", region.get("climate_samples", {})); var scale := str(region.get("scale", "local")); var seed := int(options.get("seed", bands.seed))
	for cell: Dictionary in cells:
		var band: Dictionary = by_key[_key(_gx(cell), _gy(cell))]; var wind_x := float(band.wind_x); var wind_y := float(band.wind_y); var gradient := _gradient(grid, region, cell); var projection := wind_x * gradient.x + wind_y * gradient.y
		var lift := maxf(0.0, projection); var lee := maxf(0.0, -projection); var latitude: float = bands.latitude_at(float(cell.get("y", _gy(cell)))); var equator_moisture := 1.0 - absf(latitude / (PI * 0.5)); var monsoon := 0.0
		if equator_moisture > 0.5: monsoon = (float(land_fractions.get(_gy(cell), 0.0)) - 0.5) * float(options.get("monsoon_seasonal_contrast", 1.3)) * seasonal
		var baseline := float(band.baseline_precip)
		if absf(monsoon) > 0.3: baseline = clampf(baseline * (1.0 + clampf(monsoon, -1.0, 1.0) * 0.5), 0.02, 1.0)
		var incoming: Variant = float(cell.incoming_moisture) / float(cell.incoming_moisture_count) if int(cell.incoming_moisture_count) > 0 else null
		var source_noise := NOISE.value(seed + 808, float(cell.get("x", _gx(cell))) * 0.0015, float(cell.get("y", _gy(cell))) * 0.0015, 11); var local_source := (0.42 if bool(cell.get("water", false)) else 0.12) + baseline * 0.28 + source_noise * 0.12
		var moisture := clampf((float(incoming) if incoming != null else 0.22 + baseline * 0.72) + local_source * 0.38, 0.04, 1.0); var condensation := clampf(moisture * lift * float(options.get("orographic_lift_scale", 8.5)), 0.0, moisture * 0.72); var lee_drying := lee * float(options.get("orographic_lee_scale", 1.8))
		var precipitation := clampf(baseline + (0.04 if bool(cell.get("water", false)) else 0.0) + condensation - lee_drying, 0.015, 1.0); var outgoing := clampf(moisture - condensation * 0.85 - lee_drying * 0.05 + (0.16 if bool(cell.get("water", false)) else 0.012), 0.03, 1.0); var shadow := clampf((0.34 - precipitation) * 2.4 + lee * 18.0, 0.0, 1.0) if lee > 0.001 and precipitation < 0.34 else 0.0
		cell["precipitation"] = precipitation; cell["rainfall"] = precipitation; cell["moisture"] = precipitation; cell["air_moisture"] = moisture; cell["wind_x"] = wind_x; cell["wind_y"] = wind_y; cell["baseline_precip"] = baseline; cell["pressure_cell_id"] = int(band.pressure_cell_id); cell["monsoon_index"] = monsoon; cell["rain_shadow_score"] = shadow; cell["rain_shadow"] = shadow > 0.35
		max_precipitation = maxf(max_precipitation, precipitation); if bool(cell.rain_shadow): shadow_cells += 1
		samples["%s:%d:%d" % [scale, _gx(cell), _gy(cell)]] = {"precipitation": precipitation, "rain_shadow": shadow, "wind_x": wind_x, "wind_y": wind_y, "baseline_precip": baseline, "pressure_cell_id": int(band.pressure_cell_id), "monsoon_index": monsoon}
		var step_x := 1 if wind_x > 0.35 else -1 if wind_x < -0.35 else 0; var step_y := 1 if wind_y > 0.35 else -1 if wind_y < -0.35 else 0
		if step_x == 0 and step_y == 0: step_x = 1 if wind_x >= 0.0 else -1
		var downwind: Dictionary = grid.get(_key(_gx(cell) + step_x, _gy(cell) + step_y), {})
		if not downwind.is_empty(): downwind["incoming_moisture"] = float(downwind.get("incoming_moisture", 0.0)) + outgoing; downwind["incoming_moisture_count"] = int(downwind.get("incoming_moisture_count", 0)) + 1
	region["climate_samples"] = samples; var stats := {"max_precipitation": max_precipitation, "rain_shadow_cells": shadow_cells}; region["climate"] = stats
	return stats

static func _gradient(grid: Dictionary, region: Dictionary, cell: Dictionary) -> Vector2:
	var elevation := _elevation(cell); var west: Dictionary = grid.get(_key(_gx(cell) - 1, _gy(cell)), {}); var east: Dictionary = grid.get(_key(_gx(cell) + 1, _gy(cell)), {}); var north: Dictionary = grid.get(_key(_gx(cell), _gy(cell) - 1), {}); var south: Dictionary = grid.get(_key(_gx(cell), _gy(cell) + 1), {})
	var distance := maxf(1.0, float(region.get("stride", 1.0)) * float(region.get("scale_factor", 1.0)))
	var east_elevation := _elevation(east) if not east.is_empty() else elevation; var west_elevation := _elevation(west) if not west.is_empty() else elevation; var south_elevation := _elevation(south) if not south.is_empty() else elevation; var north_elevation := _elevation(north) if not north.is_empty() else elevation
	return Vector2((east_elevation - west_elevation) * 0.5 / distance, (south_elevation - north_elevation) * 0.5 / distance)
static func _row_land_fractions(cells: Array) -> Dictionary:
	var rows := {}; var fractions := {}
	for cell: Dictionary in cells:
		var row: Dictionary = rows.get(_gy(cell), {"land": 0, "total": 0}); row["total"] = int(row.total) + 1; if not bool(cell.get("water", false)): row["land"] = int(row.land) + 1; rows[_gy(cell)] = row
	for gy in rows: var row: Dictionary = rows[gy]; fractions[gy] = float(row.land) / maxf(1.0, float(row.total))
	return fractions
static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
static func _key(gx: int, gy: int) -> String: return "%d:%d" % [gx, gy]
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx", 0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy", 0))
static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation_base", cell.get("elevation", 0.0)))
