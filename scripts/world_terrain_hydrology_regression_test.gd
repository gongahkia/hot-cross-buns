extends SceneTree
const GENERATOR=preload("res://scripts/world_generator.gd")
const HYDROLOGY=preload("res://scripts/world_hydrology_region.gd")
var failed:=false
func _initialize()->void:
	var sample:=GENERATOR.new(20260730).sample(128.0,-384.0)
	_expect(absf(float(sample.elevation)-(-.4274323554779))<.000001 and str(sample.biome)=="grassland","terrain fixture drifted")
	var first:=_solve(); var second:=_solve()
	_expect(first==second and int(first.routing.cells)==9 and int(first.accumulation.edges)==1,"hydrology fixture drifted")
	quit(1 if failed else 0)
func _solve()->Dictionary:
	var region={"scale":"region","scale_factor":2.0,"cells":{}}
	for gy in range(3):
		for gx in range(3): region.cells["%d:%d"%[gx,gy]]={"gx":gx,"gy":gy,"elevation_base":1.0 if gx==1 and gy==1 else 0.0,"rainfall":2.0 if gx==1 and gy==1 else .1}
	return HYDROLOGY.solve(region)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
