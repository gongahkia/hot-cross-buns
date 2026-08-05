class_name WorldMountainMetrics
extends RefCounted

const EPSILON := 0.000001
const NEIGHBORS := [Vector2i(-1,-1),Vector2i(0,-1),Vector2i(1,-1),Vector2i(-1,0),Vector2i(1,0),Vector2i(-1,1),Vector2i(0,1),Vector2i(1,1)]
const OPPOSITE_PAIRS := [[Vector2i(-1,0),Vector2i(1,0)],[Vector2i(0,-1),Vector2i(0,1)],[Vector2i(-1,-1),Vector2i(1,1)],[Vector2i(-1,1),Vector2i(1,-1)]]

static func classify(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var cells := _ordered_cells(region)
	if cells.is_empty():
		var empty := {"cells":0,"peaks":[],"classes":{}}
		region["mountain_metrics"] = empty
		return empty
	var grid := _grid(cells)
	var stride := float(options.get("stride",region.get("stride",1.0)))
	var scale_factor := float(options.get("scale_factor",region.get("scale_factor",1.0)))
	assert(stride > 0.0 and scale_factor > 0.0,"mountain metric stride and scale factor must be positive")
	var base_elevation := float(options.get("base_elevation",region.get("sea_level",0.0)))
	var summit_ids := {}
	var peaks: Array = []
	var claimed := {}
	for cell: Dictionary in cells: _reset(cell)
	for cell: Dictionary in cells:
		var key := _key(_gx(cell),_gy(cell))
		if claimed.has(key) or bool(cell.get("water",false)): continue
		var plateau := _plateau(cell,grid,claimed)
		if _has_higher_neighbor(plateau,grid): continue
		var summit: Dictionary = plateau[0]
		var id := _key(_gx(summit),_gy(summit))
		for member: Dictionary in plateau:
			summit_ids[_key(_gx(member),_gy(member))] = id
			member["mountain_peak"] = true
			member["mountain_peak_id"] = id
		peaks.append({"id":id,"gx":_gx(summit),"gy":_gy(summit),"elevation":_elevation(summit),"plateau":plateau})
	var records: Array = []
	for peak: Dictionary in peaks:
		var saddle := _key_saddle(peak,grid,base_elevation)
		var higher := _nearest_higher(peak,grid,stride * scale_factor)
		var prominence := maxf(0.0,float(peak.elevation) - float(saddle.elevation))
		var record := {"id":peak.id,"gx":peak.gx,"gy":peak.gy,"elevation":peak.elevation,"prominence":prominence,"key_saddle":saddle.elevation,"key_saddle_gx":saddle.gx,"key_saddle_gy":saddle.gy,"isolation":higher.distance,"higher_gx":higher.gx,"higher_gy":higher.gy,"higher_elevation":higher.elevation}
		records.append(record)
		for member: Dictionary in peak.plateau:
			member["mountain_prominence"] = prominence
			member["mountain_key_saddle"] = float(saddle.elevation)
			member["mountain_isolation"] = float(higher.distance)
			member["mountain_higher_gx"] = int(higher.gx)
			member["mountain_higher_gy"] = int(higher.gy)
	var classes := {}
	for cell: Dictionary in cells:
		var ridge_class := _ridge_class(cell,grid,summit_ids)
		cell["mountain_ridge_class"] = ridge_class
		classes[ridge_class] = int(classes.get(ridge_class,0)) + 1
	var result := {"cells":cells.size(),"peaks":records,"classes":classes}
	region["mountain_metrics"] = result
	return result

static func _reset(cell: Dictionary) -> void:
	cell["mountain_peak"] = false
	cell["mountain_peak_id"] = ""
	cell["mountain_prominence"] = 0.0
	cell["mountain_key_saddle"] = 0.0
	cell["mountain_isolation"] = -1.0
	cell["mountain_higher_gx"] = -1
	cell["mountain_higher_gy"] = -1

static func _plateau(start: Dictionary, grid: Dictionary, claimed: Dictionary) -> Array:
	var members: Array = []
	var queue: Array = [start]
	var height := _elevation(start)
	while not queue.is_empty():
		var cell: Dictionary = queue.pop_front()
		var key := _key(_gx(cell),_gy(cell))
		if claimed.has(key): continue
		claimed[key] = true
		members.append(cell)
		for offset: Vector2i in NEIGHBORS:
			var neighbor: Dictionary = grid.get(_key(_gx(cell) + offset.x,_gy(cell) + offset.y),{})
			if not neighbor.is_empty() and not bool(neighbor.get("water",false)) and absf(_elevation(neighbor) - height) <= EPSILON and not claimed.has(_key(_gx(neighbor),_gy(neighbor))): queue.append(neighbor)
	members.sort_custom(func(left: Dictionary,right: Dictionary) -> bool: return _less(left,right))
	return members

static func _has_higher_neighbor(plateau: Array, grid: Dictionary) -> bool:
	var height := _elevation(plateau[0])
	for cell: Dictionary in plateau:
		for offset: Vector2i in NEIGHBORS:
			var neighbor: Dictionary = grid.get(_key(_gx(cell) + offset.x,_gy(cell) + offset.y),{})
			if not neighbor.is_empty() and not bool(neighbor.get("water",false)) and _elevation(neighbor) > height + EPSILON: return true
	return false

static func _key_saddle(peak: Dictionary, grid: Dictionary, base_elevation: float) -> Dictionary:
	var heap: Array = []
	var visited := {}
	for member: Dictionary in peak.plateau:
		_push(heap,{"cell":member,"score":float(peak.elevation),"saddle_gx":-1,"saddle_gy":-1})
	while not heap.is_empty():
		var current := _pop(heap)
		var cell: Dictionary = current.cell
		var key := _key(_gx(cell),_gy(cell))
		if visited.has(key): continue
		visited[key] = true
		if _elevation(cell) > float(peak.elevation) + EPSILON: return {"elevation":float(current.score),"gx":int(current.saddle_gx),"gy":int(current.saddle_gy)}
		for offset: Vector2i in NEIGHBORS:
			var neighbor: Dictionary = grid.get(_key(_gx(cell) + offset.x,_gy(cell) + offset.y),{})
			if neighbor.is_empty() or bool(neighbor.get("water",false)) or visited.has(_key(_gx(neighbor),_gy(neighbor))): continue
			var score := minf(float(current.score),_elevation(neighbor))
			var saddle_gx := int(current.saddle_gx)
			var saddle_gy := int(current.saddle_gy)
			if _elevation(neighbor) < float(current.score) - EPSILON:
				saddle_gx = _gx(neighbor)
				saddle_gy = _gy(neighbor)
			_push(heap,{"cell":neighbor,"score":score,"saddle_gx":saddle_gx,"saddle_gy":saddle_gy})
	return {"elevation":base_elevation,"gx":-1,"gy":-1}

static func _nearest_higher(peak: Dictionary, grid: Dictionary, cell_size: float) -> Dictionary:
	var best := {"distance":-1.0,"gx":-1,"gy":-1,"elevation":0.0}
	var best_squared := INF
	for candidate: Dictionary in grid.values():
		if bool(candidate.get("water",false)) or _elevation(candidate) <= float(peak.elevation) + EPSILON: continue
		var dx := float(_gx(candidate) - int(peak.gx)) * cell_size
		var dy := float(_gy(candidate) - int(peak.gy)) * cell_size
		var squared := dx * dx + dy * dy
		if squared < best_squared - EPSILON or (absf(squared - best_squared) <= EPSILON and _less(candidate,{"gx":best.gx,"gy":best.gy})):
			best_squared = squared
			best = {"distance":sqrt(squared),"gx":_gx(candidate),"gy":_gy(candidate),"elevation":_elevation(candidate)}
	return best

static func _ridge_class(cell: Dictionary, grid: Dictionary, summit_ids: Dictionary) -> String:
	if bool(cell.get("water",false)): return "water"
	var gx := _gx(cell)
	var gy := _gy(cell)
	if summit_ids.has(_key(gx,gy)): return "summit"
	var elevation := _elevation(cell)
	var higher := 0
	for offset: Vector2i in NEIGHBORS:
		var neighbor: Dictionary = grid.get(_key(gx + offset.x,gy + offset.y),{})
		if neighbor.is_empty(): return "edge"
		if _elevation(neighbor) > elevation + EPSILON: higher += 1
	var higher_pairs := 0
	var lower_pairs := 0
	for pair: Array in OPPOSITE_PAIRS:
		var first: Dictionary = grid[_key(gx + (pair[0] as Vector2i).x,gy + (pair[0] as Vector2i).y)]
		var second: Dictionary = grid[_key(gx + (pair[1] as Vector2i).x,gy + (pair[1] as Vector2i).y)]
		if _elevation(first) > elevation + EPSILON and _elevation(second) > elevation + EPSILON: higher_pairs += 1
		if _elevation(first) < elevation - EPSILON and _elevation(second) < elevation - EPSILON: lower_pairs += 1
	if higher_pairs > 0 and lower_pairs > 0: return "saddle"
	if lower_pairs > 0 and higher <= 2: return "ridge"
	if higher_pairs > 0: return "valley"
	return "slope"

static func _grid(cells: Array) -> Dictionary:
	var grid := {}
	var min_x := _gx(cells[0])
	var max_x := min_x
	var min_y := _gy(cells[0])
	var max_y := min_y
	for cell: Dictionary in cells:
		var gx := _gx(cell)
		var gy := _gy(cell)
		var key := _key(gx,gy)
		assert(not grid.has(key),"mountain metric cells must have unique gx/gy coordinates")
		grid[key] = cell
		min_x = mini(min_x,gx)
		max_x = maxi(max_x,gx)
		min_y = mini(min_y,gy)
		max_y = maxi(max_y,gy)
	assert(grid.size() == (max_x - min_x + 1) * (max_y - min_y + 1),"mountain metrics require a rectangular cell grid")
	return grid

static func _ordered_cells(region: Dictionary) -> Array:
	var source: Variant = region.get("cells",[])
	var cells: Array = (source as Dictionary).values() if source is Dictionary else source if source is Array else []
	cells.sort_custom(func(left: Dictionary,right: Dictionary) -> bool: return _less(left,right))
	return cells

static func _push(heap: Array, entry: Dictionary) -> void:
	heap.append(entry)
	var index := heap.size() - 1
	while index > 0:
		var parent := (index - 1) / 2
		if _before(heap[parent],entry): break
		heap[index] = heap[parent]
		index = parent
	heap[index] = entry

static func _pop(heap: Array) -> Dictionary:
	var root: Dictionary = heap[0]
	var last: Dictionary = heap.pop_back()
	if heap.is_empty(): return root
	var index := 0
	while true:
		var left := index * 2 + 1
		var right := left + 1
		if left >= heap.size(): break
		var child := right if right < heap.size() and _before(heap[right],heap[left]) else left
		if _before(last,heap[child]): break
		heap[index] = heap[child]
		index = child
	heap[index] = last
	return root

static func _before(left: Dictionary, right: Dictionary) -> bool:
	if float(left.score) != float(right.score): return float(left.score) > float(right.score)
	return _less(left.cell,right.cell)

static func _less(left: Dictionary, right: Dictionary) -> bool:
	return _gy(left) < _gy(right) or (_gy(left) == _gy(right) and _gx(left) < _gx(right))

static func _elevation(cell: Dictionary) -> float: return float(cell.get("elevation_base",cell.get("elevation",0.0)))
static func _gx(cell: Dictionary) -> int: return int(cell.get("gx",0))
static func _gy(cell: Dictionary) -> int: return int(cell.get("gy",0))
static func _key(gx: int, gy: int) -> String: return "%d:%d" % [gx,gy]
