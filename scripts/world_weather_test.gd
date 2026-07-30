extends SceneTree
const WEATHER = preload("res://scripts/world_weather.gd")
var failed := false
func _initialize() -> void:
	var world := {"seed":20260730,"geologic_time":0.25}; var cell := {"x":12.0,"y":-8.0,"temperature":0.7,"rainfall":0.8,"slope":0.1,"wind_x":0.6,"wind_y":0.2,"pressure_cell_id":3,"koppen":"Af"}
	var state := WEATHER.sample(world,cell,{"bucket":3})
	_expect(state==WEATHER.sample(world,cell,{"bucket":3}) and int(state.bucket)==3 and str(state.koppen)=="Af" and float(state.visibility)>=.18 and str(state.audio_cue)!="", "weather sampling drifted")
	var runtime:=WEATHER.new_runtime(); WEATHER.update(runtime,31.0)
	_expect(WEATHER.bucket_for(float(runtime.clock))==1 and WEATHER.label({"storm":"none","precipitation":"rain"})=="rain" and WEATHER.particle_count({"precipitation":"rain","intensity":.5})>0, "weather runtime/presentation drifted")
	quit(1 if failed else 0)
func _expect(condition: bool,message:String)->void:
	if condition:return
	failed=true; push_error(message)
