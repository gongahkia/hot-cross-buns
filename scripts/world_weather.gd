class_name WorldWeather
extends RefCounted

const NOISE = preload("res://scripts/world_noise.gd")
const RNG = preload("res://scripts/world_rng.gd")
const KOPPEN = preload("res://scripts/world_koppen.gd")
const BUCKET_SECONDS := 30
const MAX_EVENT_SECONDS := 1200
static func bucket_for(seconds: float) -> int: return floori(maxf(0.0,seconds)/BUCKET_SECONDS)
static func new_runtime(options: Dictionary = {}) -> Dictionary: return {"clock":float(options.get("clock",int(options.get("bucket",0))*BUCKET_SECONDS)),"fixed_bucket":options.get("bucket",null)}
static func update(runtime: Dictionary, delta: float) -> Dictionary:
	if runtime.get("fixed_bucket",null)==null: runtime["clock"]=float(runtime.get("clock",0.0))+delta
	return runtime
static func sample(world: Dictionary, cell: Dictionary = {}, options: Dictionary = {}) -> Dictionary:
	var seed:=int(world.get("seed",1)); var salt:=floori(float(world.get("geologic_time",0.0))*100000.0+0.5); var x:=float(options.get("x",cell.get("x",0.0))); var y:=float(options.get("y",cell.get("y",0.0))); var bucket:=maxi(0,int(options.get("bucket",bucket_for(float(options.get("clock",0.0)))))); var seconds:=bucket*BUCKET_SECONDS; var rx:=floori(x/96.0); var ry:=floori(y/96.0); var segment:=floori(float(seconds)/MAX_EVENT_SECONDS); var duration:=clampi(1+floori(RNG.unit_at(seed+9101,rx,ry,segment,salt)*float(MAX_EVENT_SECONDS)/BUCKET_SECONDS),1,MAX_EVENT_SECONDS/BUCKET_SECONDS)*BUCKET_SECONDS; var active:=seconds-segment*MAX_EVENT_SECONDS<duration
	var wind_x:=float(cell.get("wind_x",0.0)); var wind_y:=float(cell.get("wind_y",0.0)); var front_noise:=NOISE.value(seed+4201+salt,(x-wind_x*seconds*.045)*.0065,(y-wind_y*seconds*.045)*.0065,segment); var rainfall:=clampf(float(cell.get("rainfall",cell.get("precipitation",cell.get("moisture",0.35)))),0.0,1.0); var slope:=clampf(float(cell.get("slope",0.0)),0.0,1.0); var temp_c:=float(cell.get("temperature",0.5))*60.0-24.0
	var pressure:=clampf(.52+(front_noise-.5)*.78+_pressure_offset(int(cell.get("pressure_cell_id",0)))-rainfall*.08,0.0,1.0); var low:=clampf((.56-pressure)*2.4,0.0,1.0); var high:=clampf((pressure-.54)*2.0,0.0,1.0); var orographic:=clampf(slope*1.5+(0.08 if float(cell.get("elevation",0.0))>.36 else 0.0),0.0,.35); var chance:=clampf(rainfall*.58+low*.34+orographic-high*.28-(.22 if bool(cell.get("rain_shadow",false)) else 0.0),.02,.94); if not active: chance*=.18
	var roll:=RNG.unit_at(seed+9301,rx,ry,segment,salt); var precipitating:=roll<chance; var wind_speed:=clampf(.18+Vector2(wind_x,wind_y).length()*.32+absf(.5-pressure)*.92+slope*.22,0.0,1.0); var convective:=clampf((temp_c-12.0)/22.0+rainfall*.42+low*.28,0.0,1.0); var storm_roll:=RNG.unit_at(seed+9401,rx,ry,segment,salt); var storm:="none"
	if rainfall<.24 and wind_speed>.62 and storm_roll>.78: storm="sandstorm"
	elif precipitating and temp_c < -4.0 and wind_speed>.58 and storm_roll>.72: storm="blizzard"
	elif precipitating and bool(cell.get("water",false)) and temp_c>24.0 and low>.62 and storm_roll>.86: storm="hurricane"
	elif precipitating and convective>.66 and storm_roll>.82: storm="thunderstorm"
	var intensity:=clampf(chance*.55+low*.32+RNG.unit_at(seed+9501,rx,ry,segment,salt)*.28,.15,1.0) if precipitating else 0.0; if storm!="none": intensity=clampf(intensity+.28,.35,1.0)
	var precipitation:=_precipitation(temp_c,rainfall,intensity,storm,RNG.unit_at(seed+9601,rx,ry,segment,salt)) if precipitating else "clear"; var cloud:=clampf(rainfall*.34+low*.42+(.32 if precipitating else 0.0)+(.22 if storm!="none" else 0.0),.05,1.0); var visibility:=clampf(1.0-cloud*.16-intensity*.36-(.24 if storm!="none" else 0.0),.18,1.0)
	if storm=="sandstorm": visibility=minf(visibility,.28)
	elif storm=="blizzard": visibility=minf(visibility,.24)
	elif storm=="hurricane": visibility=minf(visibility,.2)
	return {"bucket":bucket,"event_id":segment,"event_start":segment*MAX_EVENT_SECONDS,"event_duration":duration,"event_active":active,"front":"low" if low>.35 else "high" if high>.35 else "zonal","pressure":pressure,"precipitation":precipitation,"storm":storm,"intensity":intensity,"cloud_cover":cloud,"wind_speed":wind_speed,"visibility":visibility,"temperature_c":temp_c,"koppen":str(cell.get("koppen",KOPPEN.classify(float(cell.get("temperature",.5)),rainfall,cell))),"audio_cue":_audio(precipitation,storm),"is_precipitating":precipitation!="clear"}
static func label(state: Dictionary) -> String: return str(state.get("storm","none")) if str(state.get("storm","none"))!="none" else str(state.get("precipitation","clear"))
static func forecast(world: Dictionary, routes: Array, options: Dictionary = {}) -> Array:
	var clock := float(options.get("clock", 0.0)); var travel_speed := maxf(1.0, float(options.get("travel_speed", 6.0))); var forecast: Array = []
	for route: Dictionary in routes:
		var cell: Dictionary = route.get("cell", {}); var distance := maxf(0.0, float(route.get("distance", 0.0))); var weather := sample(world, cell, {"clock": clock + distance / travel_speed, "x": float(cell.get("x", 0.0)), "y": float(cell.get("y", 0.0))}); var cold := clampf((8.0 - float(weather.temperature_c)) / 32.0, 0.0, 1.0); var risk := clampf(float(weather.intensity) * .45 + float(weather.wind_speed) * .25 + (1.0 - float(weather.visibility)) * .2 + cold * .1, 0.0, 1.0)
		forecast.append({"route": str(route.get("route", "route")), "distance": distance, "eta_seconds": distance / travel_speed, "weather": weather, "risk": risk})
	return forecast
static func particle_count(state: Dictionary,width: float=1280.0,height: float=720.0) -> int:
	var area:=clampf(width*height/(1280.0*720.0),.4,1.8); var intensity:=clampf(float(state.get("intensity",0.0)),0.0,1.0); var precipitation:=str(state.get("precipitation","clear")); var storm:=str(state.get("storm","none"))
	if storm=="sandstorm": return floori((90+intensity*160)*area)
	if precipitation=="snow": return floori((50+intensity*130)*area)
	if precipitation in ["rain","downpour","drizzle","freezing_rain"]: return floori((70+intensity*190)*area)
	if precipitation in ["sleet","hail"]: return floori((45+intensity*115)*area)
	if float(state.get("visibility",1.0))<.7: return floori((24+(1.0-float(state.get("visibility",1.0)))*60)*area)
	return 0
static func _pressure_offset(id:int)->float: return .12 if id in [1,6] else -.08 if id in [2,5] else -.14 if id==3 else 0.0
static func _precipitation(temp:float,rain:float,intensity:float,storm:String,roll:float)->String: return "clear" if storm=="sandstorm" else "snow" if storm=="blizzard" or temp<=-1.0 else ("hail" if roll>.92 else "downpour") if storm=="hurricane" or storm=="thunderstorm" and intensity>.62 else ("freezing_rain" if roll>.58 else "sleet") if temp<=1.5 else "sleet" if temp<=3.5 else "downpour" if intensity>.68 or rain>.82 else "drizzle" if intensity<.32 else "rain"
static func _audio(precipitation:String,storm:String)->String: return "wind" if storm in ["sandstorm","blizzard","hurricane"] else "thunder" if storm=="thunderstorm" else "rain" if precipitation in ["rain","downpour","drizzle","freezing_rain"] else "ice" if precipitation in ["snow","sleet","hail"] else "none"
