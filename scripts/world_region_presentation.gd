class_name WorldRegionPresentation
extends RefCounted

static func palette(biome: String, family: String) -> Dictionary:
	var terrain: Color = {"ocean":Color("#2e5d6b"),"coast":Color("#8f9b70"),"desert":Color("#aa9564"),"alpine":Color("#82919b"),"nival_zone":Color("#d5e5df"),"wetland":Color("#4b7665"),"temperate_forest":Color("#55794e"),"rainforest":Color("#3e7146")}.get(biome,Color("#5e7650"))
	var family_color: Color = {"industrial_ruin":Color("#686653"),"reclaimed_city":Color("#576b59"),"flooded_city":Color("#466d72"),"overgrown_suburb":Color("#5f7951")}.get(family,terrain)
	var silhouette := family_color.darkened(0.28)
	var luminance := silhouette.get_luminance()
	return {"terrain":family_color,"silhouette":silhouette.lerp(Color(luminance,luminance,luminance),0.22)}
