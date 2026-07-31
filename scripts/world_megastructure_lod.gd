class_name WorldMegastructureLod
extends RefCounted

const SCHEMA := "megastructure-lod/v1"

static func compile(megastructure: Dictionary) -> Dictionary:
	var result := {"active_collisions": [], "macro_silhouettes": [], "schema": SCHEMA, "sector_shells": [], "traversal_details": []}
	for intersection: Dictionary in megastructure.get("intersections", []):
		var macro: Dictionary = intersection.get("macro", {})
		var interior: Dictionary = intersection.get("interior", {})
		if macro.is_empty() or str(interior.get("terrain_mode", "")) != "flat_enclosed_floor":
			continue
		var structure_id := str(intersection.get("structure_id", ""))
		var floor_y := int(interior.get("floor_y", 0))
		var ceiling_y := int(interior.get("ceiling_y", floor_y))
		var macro_id := structure_id + ":macro"
		(result.macro_silhouettes as Array).append({"bounds": macro.duplicate(true), "ceiling_y": ceiling_y, "floor_y": floor_y, "id": macro_id, "structure_id": structure_id})
		for sector: Dictionary in intersection.get("sectors", []):
			var sector_id := str(sector.get("sector_id", ""))
			(result.sector_shells as Array).append({"bounds": (sector.get("bounds", {}) as Dictionary).duplicate(true), "ceiling_y": ceiling_y, "floor_y": floor_y, "id": structure_id + ":sector:" + sector_id, "sector_id": sector_id, "structure_id": structure_id, "wall_faces": _wall_faces(intersection)})
		(result.active_collisions as Array).append({"bounds": macro.duplicate(true), "ceiling_y": ceiling_y, "floor_y": floor_y, "id": macro_id + ":collision", "structure_id": structure_id, "wall_faces": _wall_faces(intersection)})
		for segment: Dictionary in intersection.get("traversal_segments", []):
			var record := segment.duplicate(true)
			record["id"] = structure_id + ":" + str(record.get("id", ""))
			record["structure_id"] = structure_id
			(result.traversal_details as Array).append(record)
	for field: String in ["active_collisions", "macro_silhouettes", "sector_shells", "traversal_details"]:
		(result[field] as Array).sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return str(left.get("id", "")) < str(right.get("id", "")))
	return result

static func _wall_faces(intersection: Dictionary) -> Array:
	var chunk: Array = intersection.get("chunk", [])
	if chunk.size() != 2:
		return []
	var chunk_point := Vector2i(int(chunk[0]), int(chunk[1]))
	var connected := {}
	for port: Dictionary in intersection.get("structural_ports", []):
		var sides: Array = port.get("chunks", [])
		if sides.size() != 2:
			continue
		for side: Array in sides:
			if side.size() != 2 or int(side[0]) != chunk_point.x or int(side[1]) != chunk_point.y:
				continue
			var neighbor: Array = sides[1] if side == sides[0] else sides[0]
			connected["%d:%d" % [int(neighbor[0]), int(neighbor[1])]] = true
	var faces: Array = []
	for candidate: Dictionary in [{"face":"x_min","offset":Vector2i(-1,0)}, {"face":"x_max","offset":Vector2i(1,0)}, {"face":"z_min","offset":Vector2i(0,-1)}, {"face":"z_max","offset":Vector2i(0,1)}]:
		var neighbor: Vector2i = chunk_point + (candidate.offset as Vector2i)
		if not connected.has("%d:%d" % [neighbor.x, neighbor.y]):
			faces.append(str(candidate.face))
	return faces
