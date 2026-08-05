class_name WorldCityParcels
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,arterials:Dictionary,secondary:Dictionary,urban:Dictionary)->Dictionary:
	if arterials.is_empty() or secondary.is_empty() or urban.is_empty():return {}
	var x_lanes:=_lanes("z",arterials,secondary);var z_lanes:=_lanes("x",arterials,secondary);var blocks:Array=[];var parcels:Array=[]
	for x_index in range(x_lanes.size()-1):
		for z_index in range(z_lanes.size()-1):
			var x0:=float(x_lanes[x_index].offset)+float(x_lanes[x_index].width)*.5+1.0;var x1:=float(x_lanes[x_index+1].offset)-float(x_lanes[x_index+1].width)*.5-1.0;var z0:=float(z_lanes[z_index].offset)+float(z_lanes[z_index].width)*.5+1.0;var z1:=float(z_lanes[z_index+1].offset)-float(z_lanes[z_index+1].width)*.5-1.0
			if x1-x0<5.0 or z1-z0<5.0:continue
			var block:Dictionary={"id":"block:%d:%d:%d:%d"%[chunk_x,chunk_z,x_index,z_index],"x":x0,"z":z0,"width":x1-x0,"depth":z1-z0};blocks.append(block)
			var split_x:=float(block.width)>=float(block.depth);var count:=2+RNG.hash_int(seed,chunk_x+x_index,chunk_z+z_index,861)%2
			for parcel_index in range(count):
				var fraction:=1.0/float(count);var parcel:Dictionary={"id":"parcel:%d:%d:%d:%d:%d"%[chunk_x,chunk_z,x_index,z_index,parcel_index],"land_use":str(urban.land_use),"x":float(block.x)+float(parcel_index)*float(block.width)*fraction if split_x else float(block.x),"z":float(block.z) if split_x else float(block.z)+float(parcel_index)*float(block.depth)*fraction,"width":float(block.width)*fraction if split_x else float(block.width),"depth":float(block.depth) if split_x else float(block.depth)*fraction};parcels.append(parcel)
	return {"blocks":blocks,"parcels":parcels}

static func _lanes(perpendicular_axis:String,arterials:Dictionary,secondary:Dictionary)->Array:
	var lanes:Array=[{"offset":0.0,"width":0.0},{"offset":64.0,"width":0.0}]
	for source in [arterials.get("arterials",[]),secondary.get("roads",[])]:
		for road:Dictionary in source:
			if str(road.get("axis",""))==perpendicular_axis:lanes.append({"offset":float(road.get("offset",0.0)),"width":float(road.get("width",0.0))})
	lanes.sort_custom(func(left:Dictionary,right:Dictionary)->bool:return float(left.offset)<float(right.offset))
	return lanes
