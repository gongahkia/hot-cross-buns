class_name WorldIndustrialTraversal
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,layout:Dictionary,structures:Dictionary)->Dictionary:
	if layout.is_empty() or structures.is_empty():return {}
	var factories:Array=structures.get("factories",[]);var gantries:Array=structures.get("gantries",[]);if factories.is_empty() or gantries.is_empty():return {}
	var axis:=str(layout.get("service_axis","x"));var factory:Dictionary=factories[0];var gantry:Dictionary=gantries[0];var factory_length:=(float(factory.width) if axis=="x" else float(factory.depth))*.76;var direction:=-1.0 if RNG.unit(seed,chunk_x,chunk_z,1567)<.5 else 1.0;var edge:=float(factory.width)*.5 if axis=="x" else float(factory.depth)*.5;var access_x:=float(factory.x)+direction*edge if axis=="x" else float(factory.x);var access_z:=float(factory.z)+direction*edge if axis=="z" else float(factory.z)
	return {"catwalks":[{"id":"industrial_catwalk:%d:%d:factory"%[chunk_x,chunk_z],"x":float(factory.x),"z":float(factory.z),"axis":axis,"length":factory_length,"width":2.4,"height":float(factory.height)+.55},{"id":"industrial_catwalk:%d:%d:gantry"%[chunk_x,chunk_z],"x":float(gantry.x),"z":float(gantry.z),"axis":str(gantry.axis),"length":float(gantry.span),"width":1.8,"height":float(gantry.height)+.75}],"access_routes":[{"id":"industrial_access:%d:%d"%[chunk_x,chunk_z],"x":access_x,"z":access_z,"axis":axis,"direction":direction,"run":10.0,"rise":float(factory.height)+.55,"step_count":5}]}
