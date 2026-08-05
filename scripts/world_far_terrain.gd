class_name WorldFarTerrain
extends RefCounted

const RADIUS:=5
const GRID:=2

static func targets(center:Vector2i,active_radius:int)->Dictionary:
	var result:Dictionary={}
	for z in range(center.y-RADIUS,center.y+RADIUS+1):
		for x in range(center.x-RADIUS,center.x+RADIUS+1):
			if maxi(absi(x-center.x),absi(z-center.y))<=active_radius:continue
			result["%d:%d"%[x,z]]=Vector2i(x,z)
	return result
