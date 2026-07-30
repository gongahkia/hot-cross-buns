class_name WorldFloodedCityBasin
extends RefCounted

const CHUNK_SIZE:=64.0

static func sample(generator,chunk_x:int,chunk_z:int,center:Dictionary)->Dictionary:
	if str(center.region.family)!="flooded_city":return {}
	var world_x:=float(chunk_x)*CHUNK_SIZE+CHUNK_SIZE*.5;var world_z:=float(chunk_z)*CHUNK_SIZE+CHUNK_SIZE*.5
	var west:Dictionary=generator.sample(world_x-CHUNK_SIZE,world_z);var east:Dictionary=generator.sample(world_x+CHUNK_SIZE,world_z);var north:Dictionary=generator.sample(world_x,world_z-CHUNK_SIZE);var south:Dictionary=generator.sample(world_x,world_z+CHUNK_SIZE)
	var water_neighbors:=int(west.water)+int(east.water)+int(north.water)+int(south.water);var dx:=float(east.elevation)-float(west.elevation);var dz:=float(south.elevation)-float(north.elevation)
	return {"placement":"coastal_basin" if bool(center.water) or water_neighbors>0 else "inland_basin","shore_axis":"x" if absf(dx)<=absf(dz) else "z","water_neighbors":water_neighbors,"basin_depth":maxf(0.0,-float(center.elevation))}
