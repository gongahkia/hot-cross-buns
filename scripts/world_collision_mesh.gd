class_name WorldCollisionMesh
extends RefCounted

static func heightmap(generator,chunk_size:float,chunk_x:int,chunk_z:int,grid:int,height_at:Callable=Callable())->HeightMapShape3D:
	var shape:=HeightMapShape3D.new();shape.map_width=grid+1;shape.map_depth=grid+1
	var step:=chunk_size/float(grid);var heights:=PackedFloat32Array()
	for z in range(grid+1):
		for x in range(grid+1):
			var world_x:=float(chunk_x)*chunk_size+float(x)*step
			var world_z:=float(chunk_z)*chunk_size+float(z)*step
			var height:=float(height_at.call(world_x,world_z)) if height_at.is_valid() else float((generator.sample(world_x,world_z) as Dictionary).elevation)
			heights.append(height/step)
	shape.map_data=heights
	return shape
