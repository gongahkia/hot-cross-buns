extends SceneTree

const RNG = preload("res://scripts/world_rng.gd")
const EPSILON := 0.0000001

func _initialize() -> void:
	_assert_hash(1, 0, 0, 0, 0, 374764007, 0.0872565449681133)
	_assert_hash(20260730, 128, -384, 71, 0, 1828685971, 0.42577413166873)
	_assert_hash(-17, 7, 9, 11, 13, -1294021759, 0.6987120809499174)
	_assert_hash(2147483647, -2147483648, 42, -1, 99, -1828246810, 0.57432811846957)
	var rng := RNG.new(20260730)
	for expected in [900638446, 1059476999, 1838649072, 77707650, 1519525489]:
		assert(rng.next() == expected)
	var ranged_rng := RNG.new(1)
	for _index in 8:
		var value := ranged_rng.next_range(-3, 5)
		assert(value >= -3 and value <= 5)
	quit()

func _assert_hash(seed: int, a: int, b: int, c: int, d: int, expected_hash: int, expected_unit: float) -> void:
	assert(RNG.thoth_hash(seed, a, b, c, d) == expected_hash)
	assert(absf(RNG.unit_at(seed, a, b, c, d) - expected_unit) <= EPSILON)
