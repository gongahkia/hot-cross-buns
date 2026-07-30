class_name RunCardRenderer
extends RefCounted

const WIDTH := 1200
const HEIGHT := 630

static func render(payload: Dictionary) -> String:
	var world: Dictionary = payload.get("world", {}) as Dictionary
	var run: Dictionary = payload.get("run", {}) as Dictionary
	var outcome := str(run.get("outcome", "unknown")).to_upper()
	var accent := "#9bd49a" if outcome == "EXTRACTED" else "#d79c82"
	var resources := _resources(run.get("resources", {}) as Dictionary)
	var regions := _regions(run.get("regions", []) as Array)
	var run_label := "RUN #" + str(int(run.get("id", 0))).pad_zeros(4)
	return """<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"%d\" viewBox=\"0 0 %d %d\">
	<rect width=\"%d\" height=\"%d\" fill=\"#102018\"/>
<rect x=\"44\" y=\"44\" width=\"1112\" height=\"542\" rx=\"18\" fill=\"#172a20\" stroke=\"%s\" stroke-width=\"3\"/>
<path d=\"M44 470 C220 390 354 540 516 440 S816 358 1156 470 V586 H44Z\" fill=\"#294434\"/>
<path d=\"M44 510 C245 440 390 560 575 476 S920 410 1156 514 V586 H44Z\" fill=\"#1c3428\"/>
<text x=\"82\" y=\"118\" fill=\"#dcebc9\" font-family=\"monospace\" font-size=\"24\" letter-spacing=\"6\">A SLOW WALK / RUN CARD</text>
<text x=\"82\" y=\"190\" fill=\"%s\" font-family=\"monospace\" font-size=\"54\" font-weight=\"bold\">%s</text>
<text x=\"82\" y=\"236\" fill=\"#aec5a8\" font-family=\"monospace\" font-size=\"22\">%s</text>
<text x=\"82\" y=\"300\" fill=\"#dcebc9\" font-family=\"monospace\" font-size=\"28\">SEED %s</text>
<text x=\"82\" y=\"338\" fill=\"#aec5a8\" font-family=\"monospace\" font-size=\"20\">GENERATOR %s</text>
<text x=\"82\" y=\"400\" fill=\"#dcebc9\" font-family=\"monospace\" font-size=\"24\">ELAPSED %s   PICKUPS %d</text>
<text x=\"82\" y=\"438\" fill=\"#aec5a8\" font-family=\"monospace\" font-size=\"20\">%s</text>
<text x=\"650\" y=\"300\" fill=\"#dcebc9\" font-family=\"monospace\" font-size=\"24\">RESOURCES</text>
<text x=\"650\" y=\"338\" fill=\"#aec5a8\" font-family=\"monospace\" font-size=\"20\">%s</text>
<text x=\"650\" y=\"400\" fill=\"#dcebc9\" font-family=\"monospace\" font-size=\"24\">REGIONS</text>
<text x=\"650\" y=\"438\" fill=\"#aec5a8\" font-family=\"monospace\" font-size=\"20\">%s</text>
</svg>""" % [WIDTH,HEIGHT,WIDTH,HEIGHT,WIDTH,HEIGHT,accent,accent,_escape(outcome),_escape(str(run.get("level", "expedition")).to_upper()),_escape(str(world.get("seed", "0"))),_escape(str(world.get("generator_schema_version", "unknown"))),_time(float(run.get("elapsed", 0.0))),int(run.get("collectibles", 0)),_escape(run_label),_escape(resources),_escape(regions)]

static func _resources(resources: Dictionary) -> String:
	var keys: Array = resources.keys()
	keys.sort()
	var values: Array[String] = []
	for key in keys: values.append("%s %d" % [str(key).to_upper(),int(resources[key])])
	return " / ".join(values) if not values.is_empty() else "NONE"

static func _regions(regions: Array) -> String:
	var values: Array[String] = []
	for region in regions: values.append(str(region))
	return " / ".join(values) if not values.is_empty() else "NONE"

static func _time(seconds: float) -> String:
	return "%02d:%02d" % [int(seconds) / 60, int(seconds) % 60]

static func _escape(value: String) -> String:
	return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")
