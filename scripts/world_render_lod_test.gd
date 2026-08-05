extends SceneTree
const LOD=preload("res://scripts/world_render_lod.gd")
var failed:=false
func _initialize()->void:
	if LOD.grid_for_distance(0.0)!=16 or LOD.grid_for_distance(1.5)!=8 or LOD.grid_for_distance(3.0)!=4:failed=true;push_error("render LOD thresholds drifted")
	quit(1 if failed else 0)
