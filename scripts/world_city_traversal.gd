class_name WorldCityTraversal
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,massing:Dictionary)->Dictionary:
	if massing.is_empty():return {}
	var facades:Array=[];var roofs:Array=[]
	for index in range((massing.get("buildings",[]) as Array).size()):
		var building:Dictionary=(massing.buildings as Array)[index];var side_index:=RNG.hash_int(seed,chunk_x,chunk_z,929+index)%4;var side:="north" if side_index==0 else "east" if side_index==1 else "south" if side_index==2 else "west";var height:=float(building.height)
		var ledge_height:=clampf(height*(.32+RNG.unit(seed,chunk_x,chunk_z,947+index)*.24),2.0,height-1.0);var ledge_width:=maxf(2.0,(float(building.width) if side in ["north","south"] else float(building.depth))*.52)
		facades.append({"building_id":str(building.id),"side":side,"ledge_height":ledge_height,"ledge_width":ledge_width,"kind":"fire_escape" if str(building.form)=="tower" else "balcony"})
		roofs.append({"building_id":str(building.id),"kind":"mechanical" if str(building.form)=="tower" else "garden" if str(building.form)=="courtyard" else "flat","height":height})
	return {"facades":facades,"roofs":roofs}
