extends SceneTree
const BIOMES = preload("res://scripts/world_biomes.gd")
var failed := false
func _initialize() -> void:
	_expect(BIOMES.lookup(0.8,0.8,0.0,false,0.0,0.0,false,0,0,false)=="rainforest" and BIOMES.lookup(0.5,0.1,0.0,false,0.0,0.0,false,0,0,false)=="cold_desert", "terrestrial lookup drifted")
	_expect(BIOMES.lookup(0.7,0.7,-0.02,true,0.0,0.0,false,0,0,false)=="mangrove" and BIOMES.lookup(0.5,0.5,0.0,false,0.0,0.3,false,0,0,false)=="shield" and BIOMES.lookup(0.5,0.2,0.0,false,0.0,0.0,false,0,0,false,{"volcanic_form":1})=="ash_plain", "feature precedence drifted")
	var treeline := {"temperature":0.35,"rainfall":0.8,"elevation":0.5,"slope":0.0,"latitude_radians":0.0,"wind_x":1.0,"wind_y":0.0}
	_expect(BIOMES.refine(treeline)=="subalpine_krummholz" and int(treeline.treeline)==1, "treeline transition drifted")
	var riparian := {"temperature":0.7,"rainfall":0.25,"elevation":0.1,"slope":0.0,"river_bank":true}
	_expect(BIOMES.refine(riparian)=="riparian_gallery_forest" and int(riparian.riparian)==1, "riparian transition drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed=true; push_error(message)
