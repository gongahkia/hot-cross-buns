extends SceneTree
const ROADS=preload("res://scripts/world_suburb_roads.gd")
const PARCELS=preload("res://scripts/world_suburb_parcels.gd")
const GENERATOR=preload("res://scripts/world_generator.gd")
var failed:=false
func _expect(condition:bool,message:String)->void:
	if not condition:failed=true;push_error(message)
func _initialize()->void:
	var urban:Dictionary={"land_use":"residential","ruin_age_years":90};var roads:=ROADS.generate(20260730,4,-2,urban);var result:=PARCELS.generate(20260730,4,-2,urban,roads)
	_expect((result.parcels as Array).size()==4 and (result.homes as Array).size()==4 and (result.yards as Array).size()==4 and (result.utilities as Array).size()==2,"suburb parcel records missing")
	for parcel:Dictionary in result.parcels:_expect(str(parcel.id).begins_with("suburb_parcel:") and float(parcel.x)-float(parcel.width)*.5>=0.0 and float(parcel.x)+float(parcel.width)*.5<=64.0 and float(parcel.z)-float(parcel.depth)*.5>=0.0 and float(parcel.z)+float(parcel.depth)*.5<=64.0,"suburb parcel bounds drifted")
	for home:Dictionary in result.homes:_expect(str(home.id).begins_with("suburb_home:") and str(home.form) in ["bungalow","duplex","shopfront"] and float(home.width)>0.0 and float(home.depth)>0.0 and float(home.height)>=4.0,"suburb home grammar drifted")
	for utility:Dictionary in result.utilities:_expect(str(utility.id).begins_with("suburb_utility:") and float(utility.x)>=3.0 and float(utility.x)<=61.0 and float(utility.z)>=3.0 and float(utility.z)<=61.0 and float(utility.height)>=5.0,"suburb utility grammar drifted")
	_expect(result==PARCELS.generate(20260730,4,-2,urban,roads) and PARCELS.generate(1,0,0,urban,{}).is_empty(),"suburb parcels are not deterministic")
	(result.homes as Array)[0]["form"]="changed";_expect(str((PARCELS.generate(20260730,4,-2,urban,roads).homes as Array)[0].form)!="changed","suburb parcels leaked mutable state")
	var generator:=GENERATOR.new(20260730);var found:=false
	for region_z in range(-8,9):
		for region_x in range(-8,9):
			var chunk_x:=region_x*8;var chunk_z:=region_z*8;var descriptor:Dictionary=generator.chunk_descriptor(chunk_x,chunk_z)
			if str(descriptor.region.family)=="overgrown_suburb":found=true;_expect(descriptor.suburb_parcels==PARCELS.generate(20260730,chunk_x,chunk_z,descriptor.urban,descriptor.suburb_roads),"suburb parcel descriptor wiring drifted");break
		if found:break
	_expect(found,"suburb parcel fixture found no overgrown suburb")
	quit(1 if failed else 0)
