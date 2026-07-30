extends SceneTree
const ARTERIALS=preload("res://scripts/world_city_arterials.gd")
const ROADS=preload("res://scripts/world_city_secondary_roads.gd")
const PARCELS=preload("res://scripts/world_city_parcels.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var layout:Dictionary={"spine_axis":"x","terrain_slope":1.0};var urban:Dictionary={"land_use":"commercial","ruin_age_years":80};var arterials:=ARTERIALS.generate(20260730,4,-2,layout);var roads:=ROADS.generate(20260730,4,-2,arterials,urban);var result:=PARCELS.generate(20260730,4,-2,arterials,roads,urban)
	_expect((result.blocks as Array).size()>0 and (result.parcels as Array).size()>=(result.blocks as Array).size()*2,"city blocks/parcels missing")
	for parcel:Dictionary in result.parcels:_expect(float(parcel.x)>=0.0 and float(parcel.z)>=0.0 and float(parcel.x)+float(parcel.width)<=64.0 and float(parcel.z)+float(parcel.depth)<=64.0 and str(parcel.land_use)=="commercial","parcel escaped block bounds")
	_expect(result==PARCELS.generate(20260730,4,-2,arterials,roads,urban) and PARCELS.generate(1,0,0,{},roads,urban).is_empty(),"city parcels are not deterministic")
	quit(1 if failed else 0)
