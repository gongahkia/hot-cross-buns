extends SceneTree

const METRICS = preload("res://scripts/world_mountain_metrics.gd")
const EPSILON := 0.000001
var failed := false

func _initialize() -> void:
	var first := _ridge_region()
	var second := _ridge_region()
	var result := METRICS.classify(first,{"base_elevation":0.0})
	_expect(result == METRICS.classify(second,{"base_elevation":0.0}),"mountain metrics lost determinism")
	_expect(int(result.cells) == 49 and (result.peaks as Array).size() == 2,"mountain peak selection drifted")
	var high: Dictionary = (result.peaks as Array)[0]
	var low: Dictionary = (result.peaks as Array)[1]
	_expect(str(high.id) == "1:3" and absf(float(high.prominence) - 10.0) <= EPSILON and float(high.isolation) == -1.0,"global mountain metrics drifted")
	_expect(str(low.id) == "5:3" and absf(float(low.prominence) - 4.0) <= EPSILON and absf(float(low.key_saddle) - 4.0) <= EPSILON and absf(float(low.isolation) - 4.0) <= EPSILON and int(low.higher_gx) == 1 and int(low.higher_gy) == 3,"subsidiary mountain metrics drifted")
	_expect(str(first.cells["4:3"].mountain_ridge_class) == "ridge" and str(first.cells["3:3"].mountain_ridge_class) == "saddle" and str(first.cells["0:0"].mountain_ridge_class) == "edge","ridge labels drifted")
	var plateau := _plateau_region()
	var plateau_result := METRICS.classify(plateau,{"base_elevation":2.0,"stride":2.0,"scale_factor":3.0})
	_expect((plateau_result.peaks as Array).size() == 1 and str((plateau_result.peaks as Array)[0].id) == "2:2" and bool(plateau.cells["3:2"].mountain_peak) and str(plateau.cells["3:2"].mountain_peak_id) == "2:2","summit plateau handling drifted")
	_expect(METRICS.classify({"cells":[]}) == {"cells":0,"peaks":[],"classes":{}},"empty mountain metrics drifted")
	quit(1 if failed else 0)

func _ridge_region() -> Dictionary:
	var region := {"cells":{}}
	for gy in range(7):
		for gx in range(7): region.cells["%d:%d" % [gx,gy]] = {"gx":gx,"gy":gy,"elevation_base":0.0}
	region.cells["1:3"].elevation_base = 10.0
	region.cells["2:3"].elevation_base = 6.0
	region.cells["3:3"].elevation_base = 4.0
	region.cells["4:3"].elevation_base = 6.0
	region.cells["5:3"].elevation_base = 8.0
	return region

func _plateau_region() -> Dictionary:
	var region := {"cells":{}}
	for gy in range(5):
		for gx in range(5): region.cells["%d:%d" % [gx,gy]] = {"gx":gx,"gy":gy,"elevation_base":2.0}
	region.cells["2:2"].elevation_base = 10.0
	region.cells["3:2"].elevation_base = 10.0
	return region

func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true
	push_error(message)
