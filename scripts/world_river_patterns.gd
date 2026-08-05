class_name WorldRiverPatterns
extends RefCounted

const RNG = preload("res://scripts/world_rng.gd")

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var threshold := float(options.get("threshold", region.get("threshold", 1.0)))
	var braided := _apply_braided(region, threshold)
	var meanders := _apply_meanders(region, threshold, options)
	var result := {"braided_rivers": braided, "meanders": meanders}
	region["river_patterns"] = result
	return result

static func _apply_braided(region: Dictionary, threshold: float) -> int:
	var braided := 0
	for cell: Dictionary in _cells(region):
		var sediment_load := float(cell.get("sediment_flux", 0.0)) + float(cell.get("sediment", 0.0))
		var capacity := maxf(float(cell.get("sediment_capacity", 0.0)), 0.0001)
		var overloaded := sediment_load > capacity * 1.15 and sediment_load > 0.0012
		var is_braided := bool(cell.get("river", false)) and not bool(cell.get("water", false)) and overloaded and float(cell.get("slope", 0.0)) >= 0.025 and float(cell.get("slope", 0.0)) < 0.2 and float(cell.get("flow", 0.0)) > threshold * 0.85
		cell["braided_river"] = is_braided
		if is_braided:
			braided += 1
			cell["deposition"] = maxf(float(cell.get("deposition", 0.0)), float(cell.get("sediment", 0.0)) * 1.2)
	return braided

static func _apply_meanders(region: Dictionary, threshold: float, options: Dictionary) -> Dictionary:
	var width_scale := float(options.get("width_scale", 1.8))
	var migration_scale := float(options.get("migration_scale", 0.72))
	var max_lowland_slope := float(options.get("max_lowland_slope", 0.16))
	var seed := int(options.get("seed", 1))
	region["oxbow_polygons"] = []
	for cell: Dictionary in _cells(region):
		cell["meander_bend"] = 0.0
		cell["oxbow_lake"] = false
	var segments := _collect_segments(region)
	var total_sinuosity := 0.0
	var lowland_segments := 0
	var max_sinuosity := 0.0
	var oxbow_count := 0
	for segment: Array in segments:
		var average_slope := 0.0
		var average_width := 0.0
		var base_length := 0.0
		for index in range(segment.size()):
			var cell: Dictionary = segment[index]
			average_slope += float(cell.get("slope", 0.0))
			average_width += _channel_width(cell, threshold, width_scale)
			if index > 0:
				base_length += _point(cell).distance_to(_point(segment[index - 1]))
		average_slope /= float(segment.size())
		average_width /= float(segment.size())
		var start := _point(segment[0])
		var finish := _point(segment[segment.size() - 1])
		var valley_length := maxf(0.000001, start.distance_to(finish))
		var lowland := average_slope <= max_lowland_slope
		var phase := RNG.unit_at(seed, int(start.x), int(start.y), segment.size(), 1301) * TAU
		var adjusted: Array = []
		for index in range(segment.size()):
			var cell: Dictionary = segment[index]
			var point := _point(cell)
			var shifted := point
			if lowland and index > 0 and index < segment.size() - 1:
				var previous := _point(segment[index - 1])
				var following := _point(segment[index + 1])
				var tangent := following - previous
				var normal := Vector2(-tangent.y, tangent.x).normalized()
				var bend := clampf(_curvature(segment[index - 1], cell, segment[index + 1]) * average_width * 3.0 + sin(float(index + 1) * 0.9 + phase) * migration_scale, -1.0, 1.0)
				cell["meander_bend"] = bend
				if absf(bend) > 0.16:
					cell["floodplain"] = true
				shifted = point + normal * bend * average_width
				if segment.size() >= 9 and absf(bend) >= 0.5 and (index + 1) % 6 == 0 and _mark_oxbow(region, cell, normal * (1.0 if bend >= 0.0 else -1.0), average_width):
					oxbow_count += 1
			adjusted.append(shifted)
		var adjusted_length := 0.0
		for index in range(1, adjusted.size()):
			adjusted_length += (adjusted[index] as Vector2).distance_to(adjusted[index - 1])
		var sinuosity := maxf(base_length / valley_length, adjusted_length / valley_length)
		if lowland:
			lowland_segments += 1
			total_sinuosity += sinuosity
			max_sinuosity = maxf(max_sinuosity, sinuosity)
	var result := {"segments": segments.size(), "lowland_segments": lowland_segments, "mean_sinuosity": total_sinuosity / maxf(1.0, float(lowland_segments)), "max_sinuosity": max_sinuosity, "oxbow_lakes": oxbow_count}
	region["meanders"] = result
	return result

static func _collect_segments(region: Dictionary) -> Array:
	var upstream_counts := {}
	for cell: Dictionary in _cells(region):
		var down_cell: Variant = cell.get("down_cell", null)
		if bool(cell.get("river", false)) and down_cell is Dictionary and bool((down_cell as Dictionary).get("river", false)):
			var down_key := _key(int((down_cell as Dictionary).gx), int((down_cell as Dictionary).gy))
			upstream_counts[down_key] = int(upstream_counts.get(down_key, 0)) + 1
	var starts: Array = []
	for cell: Dictionary in _cells(region):
		var down_cell: Variant = cell.get("down_cell", null)
		var cell_key := _key(int(cell.gx), int(cell.gy))
		if bool(cell.get("river", false)) and down_cell is Dictionary and bool((down_cell as Dictionary).get("river", false)) and int(upstream_counts.get(cell_key, 0)) == 0:
			starts.append(cell)
	starts.sort_custom(func(left: Dictionary, right: Dictionary): return int(left.gy) < int(right.gy) or (int(left.gy) == int(right.gy) and int(left.gx) < int(right.gx)))
	var segments: Array = []
	var seen := {}
	for start: Dictionary in starts:
		_trace_segment(start, seen, segments)
	for cell: Dictionary in _cells(region):
		if bool(cell.get("river", false)) and not seen.has(_key(int(cell.gx), int(cell.gy))):
			_trace_segment(cell, seen, segments)
	return segments

static func _trace_segment(start: Dictionary, seen: Dictionary, segments: Array) -> void:
	var chain: Array = []
	var cursor: Variant = start
	var guard := 0
	while cursor is Dictionary and bool((cursor as Dictionary).get("river", false)) and not seen.has(_key(int((cursor as Dictionary).gx), int((cursor as Dictionary).gy))) and guard < 20000:
		var cell: Dictionary = cursor
		chain.append(cell)
		seen[_key(int(cell.gx), int(cell.gy))] = true
		var down_cell: Variant = cell.get("down_cell", null)
		if not (down_cell is Dictionary and bool((down_cell as Dictionary).get("river", false))):
			break
		cursor = down_cell
		guard += 1
	if chain.size() >= 4:
		segments.append(chain)

static func _channel_width(cell: Dictionary, threshold: float, width_scale: float) -> float:
	return clampf(sqrt(maxf(threshold, float(cell.get("flow", threshold))) / maxf(1.0, threshold)) * width_scale, 1.25, 5.5)

static func _curvature(previous: Dictionary, cell: Dictionary, following: Dictionary) -> float:
	var a := _point(previous) - _point(cell)
	var b := _point(following) - _point(cell)
	var chord := _point(previous).distance_to(_point(following))
	var left := maxf(0.000001, a.length())
	var right := maxf(0.000001, b.length())
	return 2.0 * (a.x * b.y - a.y * b.x) / maxf(0.000001, left * right * chord)

static func _mark_oxbow(region: Dictionary, cell: Dictionary, normal: Vector2, width: float) -> bool:
	var point := _point(cell)
	var gx := floori(point.x + normal.x * width * 1.1 + 0.5)
	var gy := floori(point.y + normal.y * width * 1.1 + 0.5)
	var oxbow: Dictionary = (region.get("cells", {}) as Dictionary).get(_key(gx, gy), {})
	if oxbow.is_empty() or bool(oxbow.get("water", false)) or bool(oxbow.get("river", false)):
		return false
	oxbow["oxbow_lake"] = true
	oxbow["floodplain"] = true
	oxbow["meander_bend"] = maxf(float(oxbow.get("meander_bend", 0.0)), 0.5)
	(region.get("oxbow_polygons", []) as Array).append({"x": gx, "y": gy, "radius": maxf(1.0, width * 0.7)})
	return true

static func _point(cell: Dictionary) -> Vector2:
	return Vector2(float(cell.get("gx", cell.get("x", 0.0))), float(cell.get("gy", cell.get("y", 0.0))))

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
