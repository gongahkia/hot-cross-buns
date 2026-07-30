class_name WorldAtmosphere
extends RefCounted

const DAY_SECONDS := 720.0
const SEASON_SECONDS := 14400.0

static func presentation(weather: Dictionary, options: Dictionary = {}) -> Dictionary:
	var clock := maxf(0.0, float(options.get("clock", 0.0)))
	var day_phase := fposmod(clock/DAY_SECONDS, 1.0)
	var daylight := clampf(sin((day_phase-0.25)*TAU)*0.5+0.5, 0.0, 1.0)
	var season := sin(TAU*clock/SEASON_SECONDS)
	var cloud := clampf(float(weather.get("cloud_cover", 0.0)), 0.0, 1.0)
	var intensity := clampf(float(weather.get("intensity", 0.0)), 0.0, 1.0)
	var temperature := clampf((float(weather.get("temperature_c", 8.0))+24.0)/60.0, 0.0, 1.0)
	var clear_sky := Color("#6f9fbd").lerp(Color("#8da37a"), season*0.5+0.5).lerp(Color("#ca9e7b"), 1.0-temperature)
	var sky := Color("#15233b").lerp(clear_sky, daylight).lerp(Color("#586673"), cloud*0.55+intensity*0.2)
	var fog_density := clampf(0.004+cloud*0.008+intensity*0.012+(1.0-float(weather.get("visibility",1.0)))*0.02, 0.004, 0.032)
	return {"background":sky,"ambient":sky.lightened(0.12),"fog":sky.darkened(0.15),"fog_density":fog_density,"sun_color":Color("#8fa7d1").lerp(Color("#fff0c2"), daylight).lerp(Color("#b8c3ce"),cloud*0.5),"sun_energy":lerpf(0.08,1.2,daylight)*(1.0-cloud*0.45),"sun_rotation":Vector3(-12.0-68.0*daylight,-34.0,0.0),"season":season,"daylight":daylight}
