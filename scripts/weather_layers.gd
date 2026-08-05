class_name WeatherLayers
extends RefCounted

const WEATHER := preload("res://scripts/world_weather.gd")

static func profile(weather: Dictionary) -> Dictionary:
	return {"particles":WEATHER.particle_count(weather),"audio":str(weather.get("audio_cue","none")),"opacity":clampf(float(weather.get("intensity",0.0))*0.7+(1.0-float(weather.get("visibility",1.0)))*0.3,0.0,1.0)}
