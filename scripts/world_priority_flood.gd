class_name WorldPriorityFlood
extends RefCounted

const NEIGHBORS := [
	{"x": -1, "y": -1, "distance": 1.41421356237}, {"x": 0, "y": -1, "distance": 1.0}, {"x": 1, "y": -1, "distance": 1.41421356237},
	{"x": -1, "y": 0, "distance": 1.0}, {"x": 1, "y": 0, "distance": 1.0},
	{"x": -1, "y": 1, "distance": 1.41421356237}, {"x": 0, "y": 1, "distance": 1.0}, {"x": 1, "y": 1, "distance": 1.41421356237},
]

static func fill(region: Dictionary, options: Dictionary = {}) -> Dictionary:
	var cells := _cells(region)
	if cells.is_empty():
		var empty := {"visit_order": [], "cells": 0, "filled_cells": 0}
		region["visit_order"] = empty.visit_order
		return empty
	var min_x := int((cells[0] as Dictionary).get("gx", 0))
	var max_x := min_x
	var min_y := int((cells[0] as Dictionary).get("gy", 0))
	var max_y := min_y
	var grid := {}
	for cell: Dictionary in cells:
		var gx := int(cell.get("gx", 0))
		var gy := int(cell.get("gy", 0))
		min_x = mini(min_x, gx)
		max_x = maxi(max_x, gx)
		min_y = mini(min_y, gy)
		max_y = maxi(max_y, gy)
		var cell_key := _key(gx, gy)
		assert(not grid.has(cell_key), "priority flood cells must have unique gx/gy coordinates")
		grid[cell_key] = cell
		cell["hydro_visited"] = false
		cell["filled_elevation"] = float(cell.get("elevation_base", cell.get("elevation", 0.0)))
		cell.erase("down_cell")
		cell.erase("down_distance")
	assert(grid.size() == (max_x - min_x + 1) * (max_y - min_y + 1), "priority flood requires a rectangular cell grid")
	var stride := float(options.get("stride", 1.0))
	var scale_factor := float(options.get("scale_factor", 1.0))
	assert(stride > 0.0 and scale_factor > 0.0, "priority flood stride and scale factor must be positive")
	var heap: Array = []
	var visit_order: Array = []
	for gx in range(min_x, max_x + 1):
		_add_boundary(grid.get(_key(gx, min_y), {}), heap, visit_order)
		_add_boundary(grid.get(_key(gx, max_y), {}), heap, visit_order)
	for gy in range(min_y + 1, max_y):
		_add_boundary(grid.get(_key(min_x, gy), {}), heap, visit_order)
		_add_boundary(grid.get(_key(max_x, gy), {}), heap, visit_order)
	while not heap.is_empty():
		var cell := _pop(heap)
		for offset: Dictionary in NEIGHBORS:
			var next_cell: Dictionary = grid.get(_key(int(cell.gx) + int(offset.x), int(cell.gy) + int(offset.y)), {})
			if not next_cell.is_empty() and not bool(next_cell.get("hydro_visited", false)):
				next_cell["hydro_visited"] = true
				next_cell["down_cell"] = cell
				next_cell["down_distance"] = float(offset.distance) * stride * scale_factor
				next_cell["filled_elevation"] = maxf(float(next_cell.get("elevation_base", next_cell.get("elevation", 0.0))), float(cell.get("filled_elevation", 0.0)))
				visit_order.append(next_cell)
				_push(heap, next_cell, float(next_cell.filled_elevation))
	var filled_cells := 0
	for cell: Dictionary in cells:
		if float(cell.get("filled_elevation", 0.0)) > float(cell.get("elevation_base", cell.get("elevation", 0.0))):
			filled_cells += 1
	var result := {"visit_order": visit_order, "cells": visit_order.size(), "filled_cells": filled_cells}
	region["visit_order"] = visit_order
	return result

static func _add_boundary(cell: Dictionary, heap: Array, visit_order: Array) -> void:
	if bool(cell.get("hydro_visited", false)):
		return
	cell["hydro_visited"] = true
	visit_order.append(cell)
	_push(heap, cell, float(cell.get("filled_elevation", 0.0)))

static func _push(heap: Array, cell: Dictionary, priority: float) -> void:
	var item := {"cell": cell, "priority": priority}
	heap.append(item)
	var index := heap.size() - 1
	while index > 0:
		var parent := (index - 1) / 2
		var parent_item: Dictionary = heap[parent]
		if float(parent_item.get("priority", 0.0)) <= priority:
			break
		heap[index] = parent_item
		index = parent
	heap[index] = item

static func _pop(heap: Array) -> Dictionary:
	var root: Dictionary = heap[0]
	var last: Dictionary = heap.pop_back()
	if not heap.is_empty():
		var index := 0
		while true:
			var left := index * 2 + 1
			var right := left + 1
			if left >= heap.size():
				break
			var child := left
			if right < heap.size() and float((heap[right] as Dictionary).get("priority", 0.0)) < float((heap[left] as Dictionary).get("priority", 0.0)):
				child = right
			var child_item: Dictionary = heap[child]
			if float(child_item.get("priority", 0.0)) >= float(last.get("priority", 0.0)):
				break
			heap[index] = child_item
			index = child
		heap[index] = last
	var cell: Dictionary = root.get("cell", {})
	return cell

static func _cells(region: Dictionary) -> Array:
	var region_cells: Variant = region.get("cells", [])
	if region_cells is Dictionary:
		return (region_cells as Dictionary).values()
	if region_cells is Array:
		return region_cells
	return []

static func _key(gx: int, gy: int) -> String:
	return "%d:%d" % [gx, gy]
