class_name WorldCollisionMesh
extends RefCounted

static func heightmap(generator,chunk_size:float,chunk_x:int,chunk_z:int,grid:int)->HeightMapShape3D:
	var shape:=HeightMapShape3D.new();shape.map_width=grid+1;shape.map_depth=grid+1
	var step:=chunk_size/float(grid);var heights:=PackedFloat32Array()
	for z in range(grid+1):
		for x in range(grid+1):
			var sample:Dictionary=generator.sample(float(chunk_x)*chunk_size+float(x)*step,float(chunk_z)*chunk_size+float(z)*step)
			heights.append(float(sample.elevation)/step)
	shape.map_data=heights
	return shape
