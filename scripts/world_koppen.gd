class_name WorldKoppen
extends RefCounted

static func classify(temperature: float, precipitation: float, cell: Dictionary = {}) -> String:
	var heat := clampf(temperature, 0.0, 1.0); var rain := clampf(precipitation, 0.0, 1.0); var latitude := minf(1.0, absf(float(cell.get("latitude_radians", 0.0))) / (PI * 0.5)); var monsoon := float(cell.get("monsoon_index", 0.0))
	if heat < 0.12: return "EF"
	if heat < 0.2: return "ET"
	if rain < 0.16: return "BWh" if heat > 0.58 else "BWk"
	if rain < 0.32: return "BSh" if heat > 0.52 else "BSk"
	if heat > 0.66:
		if rain > 0.74: return "Af"
		if rain > 0.52 or monsoon > 0.25: return "Am"
		return "Aw"
	if heat > 0.38:
		var dry_summer := latitude > 0.27 and latitude < 0.5 and monsoon < 0.16 and rain < 0.52
		if dry_summer: return "Csa" if heat > 0.58 else "Csb"
		return "Cfa" if heat > 0.58 else "Cfb"
	return "Dwb" if rain < 0.44 else "Dfb"

static func apply(cell: Dictionary) -> String:
	var value := classify(float(cell.get("temperature", 0.5)), float(cell.get("precipitation", cell.get("rainfall", 0.5))), cell)
	cell["koppen"] = value
	return value
