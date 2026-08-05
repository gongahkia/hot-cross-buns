extends SceneTree
const FIELDS=preload("res://scripts/world_urban_fields.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var industrial:=FIELDS.sample(20260730,-5,9,"industrial_ruin")
	_expect(FIELDS.sample(20260730,-5,9,"wilderness").is_empty(),"wilderness received urban fields")
	_expect(str(industrial.land_use) in ["manufacturing","logistics","utility","yard"] and int(industrial.ruin_age_years)>=90 and int(industrial.ruin_age_years)<=210,"urban fields range drifted")
	_expect(industrial==FIELDS.sample(20260730,-5,9,"industrial_ruin"),"urban fields are not deterministic")
	var generator=GENERATOR.new(20260730);var found:=false
	for region_z in range(-3,4):
		for region_x in range(-3,4):
			var descriptor:Dictionary=generator.chunk_descriptor(region_x*8,region_z*8)
			if descriptor.has("urban"):
				found=true;_expect(descriptor.urban==FIELDS.sample(20260730,region_x*8,region_z*8,str(descriptor.region.family)),"urban descriptor fields drifted");break
		if found:break
	_expect(found,"urban descriptor fixture found no urban region")
	quit(1 if failed else 0)
