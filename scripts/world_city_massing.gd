class_name WorldCityMassing
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const MAX_BUILDINGS:=8

static func generate(seed:int,chunk_x:int,chunk_z:int,parcels:Dictionary,urban:Dictionary)->Dictionary:
	if parcels.is_empty() or urban.is_empty():return {}
	var buildings:Array=[];var age:=int(urban.get("ruin_age_years",0))
	for index in range((parcels.get("parcels",[]) as Array).size()):
		if buildings.size()>=MAX_BUILDINGS:break
		var parcel:Dictionary=(parcels.parcels as Array)[index]
		if str(parcel.land_use)=="park" and RNG.unit(seed,chunk_x,chunk_z,881+index)<.6:continue
		var margin:=minf(1.2,minf(float(parcel.width),float(parcel.depth))*.15);var width:=float(parcel.width)-margin*2.0;var depth:=float(parcel.depth)-margin*2.0
		if width<2.0 or depth<2.0:continue
		var form_index:=RNG.hash_int(seed,chunk_x+index,chunk_z,887)%3;var form:="slab" if form_index==0 else "tower" if form_index==1 else "courtyard";var base:=12.0 if str(parcel.land_use) in ["commercial","civic"] else 8.0
		var height:=base+RNG.unit(seed,chunk_x,chunk_z,907+index)*18.0-float(age)*.025
		if form=="tower":height*=1.35;width*=.72;depth*=.72
		elif form=="courtyard":height*=.72
		buildings.append({"id":"building:%s"%str(parcel.id),"parcel_id":str(parcel.id),"form":form,"x":float(parcel.x)+float(parcel.width)*.5,"z":float(parcel.z)+float(parcel.depth)*.5,"width":width,"depth":depth,"height":maxf(4.0,height)})
	return {"buildings":buildings}
