class_name WorldReclaimedCityLayout
extends RefCounted

const CHUNK_SIZE:=64.0

static func sample(generator,chunk_x:int,chunk_z:int,center:Dictionary)->Dictionary:
	if str(center.region.family)!="reclaimed_city":return {}
	var world_x:=float(chunk_x)*CHUNK_SIZE+CHUNK_SIZE*.5;var world_z:=float(chunk_z)*CHUNK_SIZE+CHUNK_SIZE*.5
	var west:Dictionary=generator.sample(world_x-CHUNK_SIZE,world_z);var east:Dictionary=generator.sample(world_x+CHUNK_SIZE,world_z);var north:Dictionary=generator.sample(world_x,world_z-CHUNK_SIZE);var south:Dictionary=generator.sample(world_x,world_z+CHUNK_SIZE)
	var dx:=float(east.elevation)-float(west.elevation);var dz:=float(south.elevation)-float(north.elevation);var slope:=Vector2(dx,dz).length()*.5
	var coastal:=bool(center.water) or bool(west.water) or bool(east.water) or bool(north.water) or bool(south.water)
	var layout:="waterfront_grid" if coastal else "contour_terrace" if slope>=3.0 else "orthogonal_grid"
	return {"layout":layout,"spine_axis":"x" if absf(dx)<=absf(dz) else "z","coastal":coastal,"terrain_slope":slope}
