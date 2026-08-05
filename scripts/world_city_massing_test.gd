extends SceneTree
const ARTERIALS=preload("res://scripts/world_city_arterials.gd")
const ROADS=preload("res://scripts/world_city_secondary_roads.gd")
const PARCELS=preload("res://scripts/world_city_parcels.gd")
const MASSING=preload("res://scripts/world_city_massing.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:Dictionary={"spine_axis":"x","terrain_slope":1.0};var urban:Dictionary={"land_use":"commercial","ruin_age_years":80};var arterials:=ARTERIALS.generate(20260730,4,-2,layout);var roads:=ROADS.generate(20260730,4,-2,arterials,urban);var parcels:=PARCELS.generate(20260730,4,-2,arterials,roads,urban);var result:=MASSING.generate(20260730,4,-2,parcels,urban)
	_expect((result.buildings as Array).size()>0 and (result.buildings as Array).size()<=8,"building mass count drifted")
	for building:Dictionary in result.buildings:_expect(float(building.width)>=2.0 and float(building.depth)>=2.0 and float(building.height)>=4.0 and str(building.form) in ["slab","tower","courtyard"],"building mass grammar drifted")
	_expect(result==MASSING.generate(20260730,4,-2,parcels,urban) and MASSING.generate(1,0,0,{},urban).is_empty(),"building massing is not deterministic")
	quit(1 if failed else 0)
