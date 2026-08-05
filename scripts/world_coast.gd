class_name WorldCoast
extends RefCounted

const NEIGHBORS := [
	{"x": -1, "y": -1, "distance": 1.41421356237}, {"x": 0, "y": -1, "distance": 1.0}, {"x": 1, "y": -1, "distance": 1.41421356237},
	{"x": -1, "y": 0, "distance": 1.0}, {"x": 1, "y": 0, "distance": 1.0},
	{"x": -1, "y": 1, "distance": 1.41421356237}, {"x": 0, "y": 1, "distance": 1.0}, {"x": 1, "y": 1, "distance": 1.41421356237},
]
const COMPONENT_NEIGHBORS := [{"x": -1, "y": -1}, {"x": 0, "y": -1}, {"x": 1, "y": -1}, {"x": -1, "y": 0}, {"x": 1, "y": 0}, {"x": -1, "y": 1}, {"x": 0, "y": 1}, {"x": 1, "y": 1}]

static func apply(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var sea_level := float(options.get("sea_level", 0.0)); var cliffs := 0; var beaches := 0
	for cell: Dictionary in _cells(region):
		cell["coast_cliff"] = false; cell["coast_beach"] = false; cell["coast_exposure"] = 0.0; cell["coast_erosion"] = 0.0; cell["coast_deposition"] = 0.0; cell["coast_cape"] = false; cell["coast_spit"] = false
	var extracted := _extract_shorelines(region)
	var shorelines: Array = extracted.shorelines; var shoreline_nodes := int(extracted.nodes)
	region["shorelines"] = shorelines
	for shoreline: Dictionary in shorelines:
		for node: Dictionary in shoreline.nodes:
			var cell: Dictionary = node.cell
			var exposure := clampf(float(cell.get("wind_x", 0.0)) * float(node.nx) + float(cell.get("wind_y", 0.0)) * float(node.ny), 0.0, 1.0)
			var relief := maxf(0.0, _elevation(cell) - sea_level); var sheltered := 1.0 - exposure
			cell["coast_exposure"] = exposure
			if exposure > 0.42 and relief > 0.045:
				var erosion := clampf(exposure * relief * 0.18, 0.004, 0.055)
				cell["coast_cliff"] = true; cell["coast_erosion"] = erosion; cell["elevation"] = _elevation(cell) - erosion; cell["slope"] = clampf(maxf(float(cell.get("slope", 0.0)), 0.2 + exposure * 0.18), 0.0, 1.0); cliffs += 1
			elif sheltered > 0.45 and relief < 0.22:
				var deposition := clampf(0.006 + sheltered * 0.018 + float(cell.get("sediment", 0.0)) * 1.2 + float(node.water_neighbors) * 0.0015, 0.004, 0.045)
				cell["coast_beach"] = true; cell["coast_deposition"] = deposition; cell["elevation"] = maxf(_elevation(cell) + deposition, sea_level + 0.006); cell["slope"] = minf(float(cell.get("slope", 0.0)), 0.075); beaches += 1
	var instability := _apply_shoreline_instability(region, shorelines, options)
	var stats := {"cliffs": cliffs, "beaches": beaches, "shorelines": shorelines.size(), "shoreline_nodes": shoreline_nodes, "capes": int(instability.capes), "max_cape_score": float(instability.max_cape_score), "smoothed": int(instability.smoothed), "spits": (region.get("spits", []) as Array).size(), "lagoons": (region.get("lagoons", []) as Array).size()}
	region["coast"] = stats
	return stats

static func _extract_shorelines(region: Dictionary) -> Dictionary:
	var candidates: Array = []; var by_key := {}
	for cell: Dictionary in _cells(region):
		cell["shoreline_node"] = 0; cell["shoreline_advance"] = 0.0; cell["cape_score"] = 0.0; cell["coast_spit"] = false
		if bool(cell.get("water", false)): continue
		var normal := _coast_normal(region, cell)
		if normal.is_empty(): continue
		var node := {"cell": cell, "x": float(cell.get("gx", cell.get("x", 0))), "y": float(cell.get("gy", cell.get("y", 0))), "nx": float(normal.nx), "ny": float(normal.ny), "water_neighbors": int(normal.water_neighbors)}
		candidates.append(node); by_key[_node_key(node)] = node
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return _gx(a.cell) < _gx(b.cell) if _gy(a.cell) == _gy(b.cell) else _gy(a.cell) < _gy(b.cell))
	var visited := {}; var shorelines: Array = []; var node_index := 0
	for start: Dictionary in candidates:
		var start_key := _node_key(start)
		if visited.has(start_key): continue
		var stack: Array = [start]; var component: Array = []; visited[start_key] = true
		while not stack.is_empty():
			var node: Dictionary = stack.pop_back(); component.append(node)
			for offset: Dictionary in COMPONENT_NEIGHBORS:
				var next_node: Dictionary = by_key.get(_key(_gx(node.cell) + int(offset.x), _gy(node.cell) + int(offset.y)), {})
				if not next_node.is_empty() and not visited.has(_node_key(next_node)):
					visited[_node_key(next_node)] = true; stack.append(next_node)
		_sort_component(component)
		var shoreline := {"id": shorelines.size() + 1, "nodes": component, "length": maxf(0.0, float(component.size() - 1) * float(region.get("stride", 1.0)) * float(region.get("scale_factor", 1.0)))}
		for node: Dictionary in component:
			node_index += 1; node["index"] = node_index; node["shoreline_id"] = int(shoreline.id); (node.cell as Dictionary)["shoreline_node"] = node_index
		shorelines.append(shoreline)
	return {"shorelines": shorelines, "nodes": node_index}

static func _apply_shoreline_instability(region: Dictionary, shorelines: Array, options: Dictionary) -> Dictionary:
	var capes := 0; var smoothed := 0; var max_cape_score := 0.0; region["spits"] = []; region["lagoons"] = []
	for shoreline: Dictionary in shorelines:
		var nodes: Array = shoreline.nodes
		if nodes.size() < 3: continue
		var ds := maxf(1.0, float(region.get("stride", 1.0)) * float(region.get("scale_factor", 1.0)) * 4.0)
		var midpoint: Dictionary = nodes[ceili(float(nodes.size()) * 0.5) - 1]
		var high_angle_fraction := float(options.get("high_angle_fraction", options.get("u_hi", _default_high_angle(midpoint))))
		var flux: Array = []
		for index in range(nodes.size()): flux.append(_longshore_flux(nodes[index], float(_tangent_at(nodes, index).angle), high_angle_fraction, options))
		var target_spit := -1; var asymmetry := float(options.get("asymmetry", 0.0))
		if high_angle_fraction > 0.5 and absf(asymmetry) > 0.35 and nodes.size() >= 8:
			target_spit = maxi(2, floori(float(nodes.size()) * 0.78)) - 1 if asymmetry >= 0.0 else mini(nodes.size() - 1, floori(float(nodes.size()) * 0.22)) - 1
		for index in range(nodes.size()):
			var node: Dictionary = nodes[index]; var curvature := _curvature_seaward(nodes, index, ds)
			var divergence := (float(flux[mini(nodes.size() - 1, index + 1)]) - float(flux[maxi(0, index - 1)])) / (2.0 * ds)
			var high_gain := maxf(0.0, high_angle_fraction - 0.5); var low_gain := maxf(0.0, 0.3 - high_angle_fraction)
			var advance := clampf(-divergence * 0.02 + high_gain * maxf(0.0, -curvature) * 0.75 + low_gain * curvature * 0.55, -0.08, 0.08)
			var cell: Dictionary = node.cell
			cell["shoreline_advance"] = advance; cell["cape_score"] = maxf(0.0, -curvature) * high_angle_fraction if high_angle_fraction > 0.5 else 0.0; max_cape_score = maxf(max_cape_score, float(cell.cape_score))
			if float(cell.cape_score) > 0.008 and advance > 0.0:
				capes += 1; cell["coast_cape"] = true; cell["coast_beach"] = true; cell["coast_deposition"] = maxf(float(cell.get("coast_deposition", 0.0)), advance * 0.35); cell["elevation"] = maxf(_elevation(cell), float(options.get("sea_level", region.get("sea_level", 0.0))) + 0.008)
			elif low_gain > 0.0 and curvature < -0.004:
				smoothed += 1; cell["coast_erosion"] = maxf(float(cell.get("coast_erosion", 0.0)), absf(advance) * 0.25)
			if target_spit == index:
				cell["coast_spit"] = true; cell["coast_beach"] = true; cell["coast_deposition"] = maxf(float(cell.get("coast_deposition", 0.0)), 0.028 + absf(asymmetry) * 0.012)
				(region.spits as Array).append({"x": cell.get("x", _gx(cell)), "y": cell.get("y", _gy(cell)), "shoreline": int(shoreline.id), "node": int(node.index), "direction": 1 if asymmetry >= 0.0 else -1})
				(region.lagoons as Array).append({"x": float(cell.get("x", _gx(cell))) + float(node.nx) * ds, "y": float(cell.get("y", _gy(cell))) + float(node.ny) * ds, "shoreline": int(shoreline.id), "behind": int(node.index)})
	return {"capes": capes, "smoothed": smoothed, "max_cape_score": max_cape_score}

static func _coast_normal(region: Dictionary, cell: Dictionary) -> Dictionary:
	var nx := 0.0; var ny := 0.0; var water_neighbors := 0; var grid: Dictionary = region.get("cells", {})
	for offset: Dictionary in NEIGHBORS:
		var neighbor: Dictionary = grid.get(_key(_gx(cell) + int(offset.x), _gy(cell) + int(offset.y)), {})
		if not neighbor.is_empty() and bool(neighbor.get("water", false)):
			nx -= float(offset.x) / float(offset.distance); ny -= float(offset.y) / float(offset.distance); water_neighbors += 1
	var length := sqrt(nx * nx + ny * ny)
	return {} if length <= 0.0 else {"nx": nx / length, "ny": ny / length, "water_neighbors": water_neighbors}

static func _tangent_at(nodes: Array, index: int) -> Dictionary:
	var node: Dictionary = nodes[index]; var previous: Dictionary = nodes[maxi(0, index - 1)]; var next: Dictionary = nodes[mini(nodes.size() - 1, index + 1)]
	var tx := float(next.x) - float(previous.x); var ty := float(next.y) - float(previous.y); var length := sqrt(tx * tx + ty * ty)
	if length <= 0.0: tx = -float(node.ny); ty = float(node.nx); length = sqrt(tx * tx + ty * ty)
	return {"x": tx / length, "y": ty / length, "angle": atan2(ty, tx)}

static func _curvature_seaward(nodes: Array, index: int, ds: float) -> float:
	if index <= 0 or index >= nodes.size() - 1: return 0.0
	var previous: Dictionary = nodes[index - 1]; var node: Dictionary = nodes[index]; var next: Dictionary = nodes[index + 1]
	return ((float(next.x) + float(previous.x) - 2.0 * float(node.x)) * -float(node.nx) + (float(next.y) + float(previous.y) - 2.0 * float(node.y)) * -float(node.ny)) / maxf(1.0, ds * ds)

static func _default_high_angle(node: Dictionary) -> float:
	var tangent := _tangent_at([node], 0); var along := absf(float((node.cell as Dictionary).get("wind_x", 0.0)) * float(tangent.x) + float((node.cell as Dictionary).get("wind_y", 0.0)) * float(tangent.y))
	var storm_track := _smoothstep(deg_to_rad(42.0), deg_to_rad(56.0), absf(float((node.cell as Dictionary).get("latitude_radians", 0.0))))
	return clampf(0.24 + along * 0.28 + storm_track * 0.24, 0.12, 0.78)

static func _longshore_flux(node: Dictionary, phi: float, high_angle_fraction: float, options: Dictionary) -> float:
	var theta := _wave_angle(node, phi, high_angle_fraction, options); var theta_b := _angle_diff(theta, phi); var cosine := maxf(0.0, cos(theta_b))
	return float(options.get("transport_k", 0.39)) * pow(float(options.get("breaker_height", 1.5)), 12.0 / 5.0) * pow(cosine, 6.0 / 5.0) * sin(theta_b)

static func _wave_angle(node: Dictionary, phi: float, high_angle_fraction: float, options: Dictionary) -> float:
	if options.has("wave_angle_radians"): return phi + float(options.wave_angle_radians)
	if options.has("wave_angle_degrees"): return phi + deg_to_rad(float(options.wave_angle_degrees))
	var cell: Dictionary = node.cell; var wind_x := float(cell.get("wind_x", 0.0)); var wind_y := float(cell.get("wind_y", 0.0))
	if absf(wind_x) + absf(wind_y) > 0.0001: return atan2(wind_y, wind_x)
	return phi + (1.0 if float(options.get("asymmetry", 0.0)) >= 0.0 else -1.0) * deg_to_rad(70.0 if high_angle_fraction > 0.5 else 28.0)

static func _sort_component(nodes: Array) -> void:
	var axis_x := true; var min_x := INF; var max_x := -INF; var min_y := INF; var max_y := -INF
	for node: Dictionary in nodes: min_x = minf(min_x, float(node.x)); max_x = maxf(max_x, float(node.x)); min_y = minf(min_y, float(node.y)); max_y = maxf(max_y, float(node.y))
	axis_x = max_x - min_x >= max_y - min_y
	nodes.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.y) < float(b.y) if float(a.x) == float(b.x) else float(a.x) < float(b.x) if axis_x else float(a.x) < float(b.x) if float(a.y) == float(b.y) else float(a.y) < float(b.y))

static func _angle_diff(a: float, b: float) -> float: return fposmod(a - b + PI, TAU) - PI
static func _smoothstep(minimum: float, maximum: float, value: float) -> float:
	var t := clampf((value - minimum) / (maximum - minimum), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
static func _cells(region: Dictionary) -> Array: return (region.get("cells", {}) as Dictionary).values()
static func _key(gx: int, gy: int) -> String: return "%d:%d" % [gx, gy]
static func _node_key(node: Dictionary) -> String: return _key(_gx(node.cell), _gy(node.cell))
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx", 0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy", 0))
static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation", cell.get("elevation_base", 0.0)))
