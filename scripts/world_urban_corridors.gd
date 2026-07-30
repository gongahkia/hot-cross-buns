class_name WorldUrbanCorridors
extends RefCounted

const CHUNK_SIZE:=64.0

static func generate(generator,chunk_x:int,chunk_z:int,sample_data:Dictionary)->Dictionary:
	var family:=str(sample_data.get("region",{}).get("family","wilderness"));var corridors:Array=[];var center_x:=float(chunk_x)*CHUNK_SIZE+CHUNK_SIZE*.5;var center_z:=float(chunk_z)*CHUNK_SIZE+CHUNK_SIZE*.5
	for direction in [Vector2i(-1,0),Vector2i(1,0),Vector2i(0,-1),Vector2i(0,1)]:
		var neighbor:Dictionary=generator.region_at(Vector3(center_x+float(direction.x)*CHUNK_SIZE,0.0,center_z+float(direction.y)*CHUNK_SIZE));var neighbor_family:=str(neighbor.family);var crosses:=(family=="wilderness") != (neighbor_family=="wilderness");if not crosses:continue
		var axis:="x" if direction.x!=0 else "z";corridors.append({"id":"urban_corridor:%d:%d:%d:%d"%[chunk_x,chunk_z,direction.x,direction.y],"axis":axis,"direction":[direction.x,direction.y],"width":8.0,"urban_family":neighbor_family if family=="wilderness" else family})
	return {} if corridors.is_empty() else {"corridors":corridors}
