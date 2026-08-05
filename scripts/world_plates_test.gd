extends SceneTree

const PLATES = preload("res://scripts/world_plates.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var plates = PLATES.new(20260730, 640.0, 2)
	var first := plates.center(0, -1)
	_assert_center(first, 1026967433, 418.16730633378, -93.168891066313, 0, -1)
	first["x"] = 0.0
	_assert_center(plates.center(0, -1), 1026967433, 418.16730633378, -93.168891066313, 0, -1)
	_assert_center(plates.center(-2, 3), 933831916, -851.30188983679, 2479.3843075633, -2, 3)
	_assert_center(plates.center_at(-1.0, -641.0), -976849543, -420.02500676513, -1173.6112114131, -1, -2)
	_expect(plates.cache_metrics() == {"hits": 1, "misses": 3, "evictions": 1, "size": 2, "capacity": 2, "geologic_time": 0.0}, "plate cache LRU metrics drifted")
	_assert_center(plates.center(0, -1), 1026967433, 418.16730633378, -93.168891066313, 0, -1)
	_expect(plates.cache_metrics() == {"hits": 1, "misses": 4, "evictions": 2, "size": 2, "capacity": 2, "geologic_time": 0.0}, "plate cache eviction order drifted")
	plates.clear_cache()
	_expect(int(plates.cache_metrics().get("size", -1)) == 0, "plate cache clear failed")
	var uncached = PLATES.new(20260730, 640.0, 0)
	uncached.center(0, -1)
	uncached.center(0, -1)
	_expect(uncached.cache_metrics() == {"hits": 0, "misses": 2, "evictions": 0, "size": 0, "capacity": 0, "geologic_time": 0.0}, "zero-capacity plate cache drifted")
	quit(1 if failed else 0)

func _assert_center(center: Dictionary, expected_id: int, x: float, z: float, cell_x: int, cell_z: int) -> void:
	_expect(int(center.get("id", 0)) == expected_id, "plate center id drifted")
	_expect(absf(float(center.get("x", 0.0)) - x) <= EPSILON, "plate center x drifted")
	_expect(absf(float(center.get("z", 0.0)) - z) <= EPSILON, "plate center z drifted")
	_expect(int(center.get("cell_x", 0)) == cell_x and int(center.get("cell_z", 0)) == cell_z, "plate center cell drifted")

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
