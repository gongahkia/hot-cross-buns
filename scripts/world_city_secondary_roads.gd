class_name WorldCitySecondaryRoads
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,arterials:Dictionary,urban:Dictionary)->Dictionary:
	if arterials.is_empty() or urban.is_empty():return {}
	var roads:Array=[]
	for axis in ["x","z"]:
		for offset in [16.0,48.0]:
			if _clear(axis,offset,2.4,arterials):roads.append({"kind":"secondary","axis":axis,"offset":offset,"width":2.4})
		for index in range(4):
			var offset:=8.0+float(index)*16.0;var cross:=chunk_z if axis=="x" else chunk_x
			if RNG.unit(seed,cross,index,841 if axis=="x" else 853)>.5 and _clear(axis,offset,1.1,arterials):roads.append({"kind":"alley","axis":axis,"offset":offset,"width":1.1})
	return {"roads":roads}

static func _clear(axis:String,offset:float,width:float,arterials:Dictionary)->bool:
	for road:Dictionary in arterials.get("arterials",[]):
		if str(road.get("axis",""))==axis and absf(float(road.get("offset",0.0))-offset)<(float(road.get("width",0.0))+width)*.5+1.0:return false
	return true
