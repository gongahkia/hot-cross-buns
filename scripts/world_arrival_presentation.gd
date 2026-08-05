class_name WorldArrivalPresentation
extends RefCounted

static func presentation(region: Dictionary, biome: String) -> Dictionary:
	var family := str(region.get("family", "wilderness"))
	var landmark := str(region.get("landmark", ""))
	var color: Color = {"reclaimed_city":Color("#c8d8a8"),"flooded_city":Color("#a6d6dc"),"industrial_ruin":Color("#d2c49f"),"overgrown_suburb":Color("#b9d695"),"wilderness":Color("#c4d79b")}.get(family, Color("#d8e7c2"))
	return {"title":str(region.get("name", "Unknown")).to_upper(),"subtitle":("%s / %s" % [_label(family), _label(biome)]).to_upper(),"landmark":"LANDMARK / " + _label(landmark).to_upper() if not landmark.is_empty() else "","color":color}

static func _label(value: String) -> String:
	return value.replace("_", " ").capitalize()
