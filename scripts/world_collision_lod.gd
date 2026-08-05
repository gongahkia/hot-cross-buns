class_name WorldCollisionLod
extends RefCounted

static func grid_for_distance(distance_chunks:float)->int:return 16 if distance_chunks<=1.0 else 8 if distance_chunks<=2.0 else 4
