extends SceneTree

const BASIN = preload("res://scripts/world_coarse_basin.gd")

var failed := false

func _initialize() -> void:
	var region := BASIN.solve(Callable(self, "_sample"), 0, 0, {"basin_chunks": 1, "stride": 2, "chunk_size": 6, "sea_level": -999.0})
	_expect(int(region.cells.size()) == 9 and int(region.stats.basins) > 0, "coarse basin grid/terminal setup drifted")
	_expect(int(region.stats.rivers) > 0 and float(region.stats.max_flow) > float(region.threshold), "coarse basin river accumulation drifted")
	var channel := BASIN.flow_for(region, 3, 2)
	_expect(float(channel.weight) > 0.0 and float(channel.flow) > 0.0, "coarse basin channel projection drifted")
	_expect(BASIN.solve(Callable(self, "_sample"), 0, 0, {"basin_chunks": 1, "stride": 1}).is_empty(), "disabled coarse basin result drifted")
	_expect(BASIN.region_index(-1, 8) == 0 and BASIN.region_start(0, 8) == -4, "coarse basin negative region mapping drifted")
	quit(1 if failed else 0)

func _sample(world_x: float, world_y: float, _scale_id: String) -> Dictionary:
	return {"elevation_base": -world_x, "rainfall": 100.0, "slope": 0.0}

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
