class_name WorldSuburbParcels
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,urban:Dictionary,roads:Dictionary)->Dictionary:
	if urban.is_empty() or roads.is_empty():return {}
	var collector:Dictionary=roads.get("collector",{});var local_roads:Array=roads.get("local_roads",[]);if collector.is_empty() or local_roads.is_empty():return {}
	var local:Dictionary=local_roads[0];var split_x:=float(local.offset) if str(local.axis)=="z" else float(collector.offset);var split_z:=float(collector.offset) if str(collector.axis)=="x" else float(local.offset);var ranges_x:Array=[[4.0,split_x-3.0],[split_x+3.0,60.0]];var ranges_z:Array=[[4.0,split_z-3.0],[split_z+3.0,60.0]];var parcels:Array=[];var homes:Array=[];var yards:Array=[]
	for index in range(4):
		var column:=index%2;var row:=index/2;var min_x:=float(ranges_x[column][0]);var max_x:=float(ranges_x[column][1]);var min_z:=float(ranges_z[row][0]);var max_z:=float(ranges_z[row][1]);var width:=maxf(4.0,max_x-min_x);var depth:=maxf(4.0,max_z-min_z);var x:=(min_x+max_x)*.5;var z:=(min_z+max_z)*.5;var form:="bungalow" if RNG.unit(seed,chunk_x,chunk_z,1753+index)<.5 else "duplex" if RNG.unit(seed,chunk_x,chunk_z,1769+index)<.82 else "shopfront";var home_width:=maxf(3.0,width*.62);var home_depth:=maxf(3.0,depth*.58);var height:=4.0+RNG.unit(seed,chunk_x,chunk_z,1783+index)*4.0
		parcels.append({"id":"suburb_parcel:%d:%d:%d"%[chunk_x,chunk_z,index],"x":x,"z":z,"width":width,"depth":depth,"land_use":str(urban.land_use)});homes.append({"id":"suburb_home:%d:%d:%d"%[chunk_x,chunk_z,index],"parcel_id":"suburb_parcel:%d:%d:%d"%[chunk_x,chunk_z,index],"form":form,"x":x,"z":z,"width":home_width,"depth":home_depth,"height":height});yards.append({"id":"suburb_yard:%d:%d:%d"%[chunk_x,chunk_z,index],"parcel_id":"suburb_parcel:%d:%d:%d"%[chunk_x,chunk_z,index],"x":x,"z":z,"width":width*.9,"depth":depth*.9})
	var utilities:Array=[]
	for index in range(2):utilities.append({"id":"suburb_utility:%d:%d:%d"%[chunk_x,chunk_z,index],"x":clampf(split_x+(-1.0 if index==0 else 1.0)*5.0,3.0,61.0),"z":clampf(split_z+(-1.0 if index==0 else 1.0)*5.0,3.0,61.0),"height":5.0+RNG.unit(seed,chunk_x,chunk_z,1801+index)*3.0})
	return {"parcels":parcels,"homes":homes,"yards":yards,"utilities":utilities}
