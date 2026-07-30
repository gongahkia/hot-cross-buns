class_name WorldIndustrialStructures
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func generate(seed:int,chunk_x:int,chunk_z:int,layout:Dictionary)->Dictionary:
	if layout.is_empty():return {}
	var sites:Array=layout.get("sites",[]);if sites.size()<4:return {}
	var axis:=str(layout.get("service_axis","x"));var cross_axis:="z" if axis=="x" else "x";var factory:Dictionary=sites[0];var tank_site:Dictionary=sites[1];var gantry_site:Dictionary=sites[2];var service_site:Dictionary=sites[3];var factory_height:=10.0+RNG.unit(seed,chunk_x,chunk_z,1501)*12.0;var tank_radius:=maxf(1.8,minf(float(tank_site.width),float(tank_site.depth))*.15);var tanks:Array=[];var pipes:Array=[]
	for index in range(2):
		var shift:=-1.0 if index==0 else 1.0;tanks.append({"id":"industrial_tank:%d:%d:%d"%[chunk_x,chunk_z,index],"x":float(tank_site.x)+(tank_radius*1.35*shift if axis=="x" else 0.0),"z":float(tank_site.z)+(tank_radius*1.35*shift if axis=="z" else 0.0),"radius":tank_radius,"height":6.0+RNG.unit(seed,chunk_x,chunk_z,1517+index)*8.0})
		var pipe_axis:=axis if index==0 else cross_axis;var length:=(float(service_site.width) if pipe_axis=="x" else float(service_site.depth))*.72;pipes.append({"id":"industrial_pipe:%d:%d:%d"%[chunk_x,chunk_z,index],"x":float(service_site.x)+(float(index)*1.8 if axis=="x" else 0.0),"z":float(service_site.z)+(float(index)*1.8 if axis=="z" else 0.0),"axis":pipe_axis,"length":length,"height":4.5+RNG.unit(seed,chunk_x,chunk_z,1531+index)*3.0,"radius":.34})
	var gantry_span:=(float(gantry_site.width) if axis=="x" else float(gantry_site.depth))*.78;var conveyor_length:=(float(service_site.width) if axis=="x" else float(service_site.depth))*.76
	return {"factories":[{"id":"industrial_factory:%d:%d"%[chunk_x,chunk_z],"x":float(factory.x),"z":float(factory.z),"width":float(factory.width),"depth":float(factory.depth),"height":factory_height}],"tanks":tanks,"gantries":[{"id":"industrial_gantry:%d:%d"%[chunk_x,chunk_z],"x":float(gantry_site.x),"z":float(gantry_site.z),"axis":axis,"span":gantry_span,"height":7.0+RNG.unit(seed,chunk_x,chunk_z,1549)*5.0}],"pipes":pipes,"conveyors":[{"id":"industrial_conveyor:%d:%d"%[chunk_x,chunk_z],"x":float(service_site.x),"z":float(service_site.z),"axis":axis,"length":conveyor_length,"height":1.2}]}
