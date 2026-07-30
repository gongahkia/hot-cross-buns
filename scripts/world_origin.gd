class_name WorldOrigin
extends RefCounted

var chunk_size: float
var threshold_chunks: int
var origin_chunk := Vector2i.ZERO
func _init(next_chunk_size: float,next_threshold_chunks:int=32)->void:
	chunk_size=next_chunk_size;threshold_chunks=next_threshold_chunks
	assert(chunk_size>0.0 and threshold_chunks>0,"origin settings must be positive")
func world_position(local:Vector3)->Vector3:return local+Vector3(float(origin_chunk.x)*chunk_size,0.0,float(origin_chunk.y)*chunk_size)
func chunk_at_local(local:Vector3)->Vector2i:
	var world:=world_position(local)
	return Vector2i(floori(world.x/chunk_size),floori(world.z/chunk_size))
func local_chunk_position(chunk:Vector2i)->Vector3:return Vector3(float(chunk.x-origin_chunk.x)*chunk_size,0.0,float(chunk.y-origin_chunk.y)*chunk_size)
func rebase_delta(player_local:Vector3)->Vector3:
	var target:=chunk_at_local(player_local)
	if maxi(absi(target.x-origin_chunk.x),absi(target.y-origin_chunk.y))<threshold_chunks:return Vector3.ZERO
	var delta:=Vector3(float(origin_chunk.x-target.x)*chunk_size,0.0,float(origin_chunk.y-target.y)*chunk_size);origin_chunk=target;return delta
