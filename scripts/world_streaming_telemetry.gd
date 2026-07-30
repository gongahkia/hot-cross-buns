class_name WorldStreamingTelemetry
extends RefCounted

var hitch_ms:float
var capacity:int
var samples:=0
var hitch_count:=0
var max_refresh_ms:=0.0
var recent_hitches:Array=[]

func _init(next_hitch_ms:float=22.0,next_capacity:int=64)->void:
	hitch_ms=maxf(0.0,next_hitch_ms);capacity=maxi(0,next_capacity)

func record_refresh(duration_ms:float,context:Dictionary={})->Dictionary:
	samples+=1;max_refresh_ms=maxf(max_refresh_ms,duration_ms)
	if duration_ms<hitch_ms:return {}
	hitch_count+=1
	var sample:=context.duplicate(true);sample["refresh_ms"]=duration_ms
	if capacity>0:
		recent_hitches.append(sample)
		if recent_hitches.size()>capacity:recent_hitches.pop_front()
	return sample.duplicate(true)

func summary()->Dictionary:
	return {"samples":samples,"hitches":hitch_count,"max_refresh_ms":max_refresh_ms,"recent_hitches":recent_hitches.duplicate(true)}
