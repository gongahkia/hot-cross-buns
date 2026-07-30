class_name WorldPreloadCorridor
extends RefCounted

const START_DISTANCE:=3
const END_DISTANCE:=10
const HALF_WIDTH:=1

static func targets(center:Vector2i,heading:Vector2)->Dictionary:
	var direction:=Vector2i(signi(heading.x),signi(heading.y))
	if direction==Vector2i.ZERO:return {}
	var lateral:=Vector2i(-direction.y,direction.x);var result:Dictionary={}
	for distance in range(START_DISTANCE,END_DISTANCE+1):
		for offset in range(-HALF_WIDTH,HALF_WIDTH+1):
			var chunk:=center+direction*distance+lateral*offset
			result["%d:%d"%[chunk.x,chunk.y]]=chunk
	return result
