class_name WorldSuburbTransitions
extends RefCounted

static func generate(_seed:int,_chunk_x:int,_chunk_z:int,parcels:Dictionary,roads:Dictionary)->Dictionary:
	if parcels.is_empty() or roads.is_empty():return {}
	var homes:Array=parcels.get("homes",[]);var collector:Dictionary=roads.get("collector",{});var local_roads:Array=roads.get("local_roads",[]);if homes.is_empty() or collector.is_empty() or local_roads.is_empty():return {}
	var local:Dictionary=local_roads[0];var split_x:=float(local.offset) if str(local.axis)=="z" else float(collector.offset);var split_z:=float(collector.offset) if str(collector.axis)=="x" else float(local.offset);var entries:Array=[];var interiors:Array=[]
	for home:Dictionary in homes:
		var x:=float(home.x);var z:=float(home.z);var side:="east" if x<split_x else "west" if absf(x-split_x)<=absf(z-split_z) else "south" if z<split_z else "north";var entry_x:=x+(float(home.width)*.5 if side=="east" else -float(home.width)*.5 if side=="west" else 0.0);var entry_z:=z+(float(home.depth)*.5 if side=="south" else -float(home.depth)*.5 if side=="north" else 0.0);var entry_id:="suburb_entry:%s"%str(home.id)
		entries.append({"id":entry_id,"home_id":str(home.id),"side":side,"x":entry_x,"z":entry_z,"width":1.6,"porch_depth":2.4});interiors.append({"id":"suburb_interior:%s"%str(home.id),"home_id":str(home.id),"entry_id":entry_id,"clear_width":1.6})
	return {"entries":entries,"interiors":interiors}
