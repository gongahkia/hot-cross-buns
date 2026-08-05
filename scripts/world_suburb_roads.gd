class_name WorldSuburbRoads
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")
const USES=["residential","community","greenbelt","retail"]

static func generate(seed:int,chunk_x:int,chunk_z:int,urban:Dictionary)->Dictionary:
	if USES.find(str(urban.get("land_use","")))<0:return {}
	var region_x:=floori(float(chunk_x)/8.0);var region_z:=floori(float(chunk_z)/8.0);var axis:="x" if RNG.unit(seed,region_x,region_z,1673)<.5 else "z";var cross_axis:="z" if axis=="x" else "x";var collector_offset:=12.0+RNG.unit(seed,0,chunk_z,1691)*40.0 if axis=="x" else 12.0+RNG.unit(seed,chunk_x,0,1693)*40.0;var local_offset:=16.0+RNG.unit(seed,chunk_x,chunk_z,1709)*32.0;var culdesacs:Array=[]
	for index in range(2):
		var cul_axis:=cross_axis if index==0 else axis;var end:=52.0 if RNG.unit(seed,chunk_x,chunk_z,1723+index)<.5 else 12.0;var offset:=16.0+RNG.unit(seed,chunk_x,chunk_z,1739+index)*32.0;var x:=end if cul_axis=="x" else offset;var z:=offset if cul_axis=="x" else end
		culdesacs.append({"id":"suburb_culdesac:%d:%d:%d"%[chunk_x,chunk_z,index],"axis":cul_axis,"x":x,"z":z,"length":24.0,"width":2.6,"radius":4.0})
	return {"collector":{"axis":axis,"offset":collector_offset,"width":4.4},"local_roads":[{"axis":cross_axis,"offset":local_offset,"width":2.6}],"culdesacs":culdesacs}
