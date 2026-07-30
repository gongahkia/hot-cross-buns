class_name WorldUrbanResources
extends RefCounted

const FAMILIES := ["reclaimed_city", "flooded_city", "industrial_ruin", "overgrown_suburb"]

static func generate(descriptor: Dictionary) -> Dictionary:
	var family := str(descriptor.get("region", {}).get("family", ""))
	if not FAMILIES.has(family): return {}
	var records: Array = []
	if family == "reclaimed_city": records = descriptor.get("city_rooftop_resources", {}).get("resources", [])
	elif family == "flooded_city": records = descriptor.get("flood_ecology", {}).get("resources", [])
	elif family == "industrial_ruin": records = descriptor.get("industrial_resources", {}).get("resources", [])
	else: records = descriptor.get("suburb_resources", {}).get("resources", [])
	var resources: Array = []
	for record: Dictionary in records:
		resources.append({"id":str(record.get("id", "")), "kind":str(record.get("kind", "")), "family":family, "source":str(record.get("source", "roof" if family == "reclaimed_city" else "water" if family == "flooded_city" else ""))})
	return {"family":family,"resources":resources}
