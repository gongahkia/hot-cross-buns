class_name WorldUrbanFields
extends RefCounted

const RNG=preload("res://scripts/world_rng.gd")

static func sample(seed:int,chunk_x:int,chunk_z:int,family:String)->Dictionary:
	var uses:Array=[];var base_age:=0
	if family=="reclaimed_city":uses=["residential","commercial","civic","park"];base_age=60
	elif family=="flooded_city":uses=["canal","waterfront","residential","marsh"];base_age=35
	elif family=="industrial_ruin":uses=["manufacturing","logistics","utility","yard"];base_age=90
	elif family=="overgrown_suburb":uses=["residential","community","greenbelt","retail"];base_age=45
	if uses.is_empty():return {}
	return {"land_use":str(uses[RNG.hash_int(seed,chunk_x,chunk_z,801)%uses.size()]),"ruin_age_years":base_age+RNG.hash_int(seed,chunk_x,chunk_z,809)%121}
