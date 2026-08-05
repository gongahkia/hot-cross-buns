class_name WorldDiagnostics
extends RefCounted

static func summary(sample: Dictionary) -> String:
	if sample.is_empty(): return "NATURAL DATA UNAVAILABLE"
	var region: Dictionary = sample.get("region", {})
	return "NAT E %.3f  T %.3f  R %.3f\nBIOME %s  WATER %s  SCALE %s×%s\nREGION %s  %s" % [float(sample.get("elevation",0.0)),float(sample.get("temperature",0.0)),float(sample.get("rainfall",sample.get("precipitation",0.0))),str(sample.get("biome","unknown")),"YES" if bool(sample.get("water",false)) else "NO",str(sample.get("scale","local")),str(sample.get("scale_factor",1)),str(region.get("id","unknown")),str(region.get("family","unknown"))]
