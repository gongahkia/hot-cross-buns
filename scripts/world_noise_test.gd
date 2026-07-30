extends SceneTree

const NOISE = preload("res://scripts/world_noise.gd")
const EPSILON := 0.000001

func _initialize() -> void:
	var value := NOISE.value(20260625, 384.25, -192.75, 9)
	var fbm := NOISE.fbm(20260625, 384.25, -192.75, 5, 0.01, 2.0, 0.5, 9)
	var ridge := NOISE.ridge(20260625, 384.25, -192.75, 5, 0.01, 2.0, 0.5, 9)
	var warp := NOISE.warp(20260625, 384.25, -192.75, 32.0, 0.005)
	assert(absf(value - 0.87093022187061) <= EPSILON)
	assert(absf(fbm - 0.80078079294632) <= EPSILON)
	assert(absf(ridge - 0.39843841410736) <= EPSILON)
	assert(warp.distance_to(Vector2(373.99391833306, -207.09059573171)) <= EPSILON)
	assert(value >= 0.0 and value <= 1.0)
	assert(fbm >= 0.0 and fbm <= 1.0)
	assert(ridge >= 0.0 and ridge <= 1.0)
	assert(warp == NOISE.warp(20260625, 384.25, -192.75, 32.0, 0.005))
	quit()
