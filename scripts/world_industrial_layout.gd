class_name WorldIndustrialLayout
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const PROGRAMS={"manufacturing":["factory","assembly","warehouse","yard"],"logistics":["warehouse","depot","yard","utility"],"utility":["utility","tank_farm","substation","yard"],"yard":["yard","depot","warehouse","utility"]}

static func generate(seed:int,chunk_x:int,chunk_z:int,urban:Dictionary)->Dictionary:
	var zone:=str(urban.get("land_use",""));if not PROGRAMS.has(zone):return {}
	var axis:="x" if RNG.unit(seed,chunk_x,chunk_z,1403)<.5 else "z";var sites:Array=[];var programs:Array=PROGRAMS[zone]
	for index in range(4):
		var column:=index%2;var row:=index/2;var width:=15.0+RNG.unit(seed,chunk_x,chunk_z,1421+index)*6.0;var depth:=15.0+RNG.unit(seed,chunk_x,chunk_z,1437+index)*6.0;var x:=16.0+float(column)*32.0+(RNG.unit(seed,chunk_x,chunk_z,1451+index)*2.0-1.0)*2.5;var z:=16.0+float(row)*32.0+(RNG.unit(seed,chunk_x,chunk_z,1467+index)*2.0-1.0)*2.5
		sites.append({"id":"industrial_site:%d:%d:%d"%[chunk_x,chunk_z,index],"program":str(programs[(index+RNG.hash_int(seed,chunk_x,chunk_z,1481))%programs.size()]),"x":x,"z":z,"width":width,"depth":depth,"orientation":axis})
	return {"zone":zone,"service_axis":axis,"ruin_age_years":int(urban.get("ruin_age_years",0)),"sites":sites}
