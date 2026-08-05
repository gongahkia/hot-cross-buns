class_name WorldChunkMemoryTelemetry
extends RefCounted

const VERTEX_FLOATS:=5
const FLOAT_BYTES:=4

static func snapshot(render_grids:Array,collision_grids:Array,far_chunks:int,cached_descriptors:int,static_memory_bytes:int=0)->Dictionary:
	var render_vertices:=0;var collision_heights:=0
	for grid in render_grids:render_vertices+=int(grid)*int(grid)*6
	for grid in collision_grids:collision_heights+=(int(grid)+1)*(int(grid)+1)
	var far_vertices:=maxi(0,far_chunks)*2*2*6
	var render_payload_bytes:=(render_vertices+far_vertices)*VERTEX_FLOATS*FLOAT_BYTES
	var collision_payload_bytes:=collision_heights*FLOAT_BYTES
	return {"active_chunks":render_grids.size(),"far_chunks":maxi(0,far_chunks),"cached_descriptors":maxi(0,cached_descriptors),"render_vertices":render_vertices,"far_vertices":far_vertices,"collision_heights":collision_heights,"render_payload_bytes":render_payload_bytes,"collision_payload_bytes":collision_payload_bytes,"minimum_payload_bytes":render_payload_bytes+collision_payload_bytes,"static_memory_bytes":maxi(0,static_memory_bytes)}
