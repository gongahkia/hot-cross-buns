extends SceneTree

const NOISE = preload("res://scripts/world_noise.gd")
const EPSILON := 0.000001

var failed := false

func _initialize() -> void:
	var value := NOISE.value(20260625, 384.25, -192.75, 9)
	var fbm := NOISE.fbm(20260625, 384.25, -192.75, 5, 0.01, 2.0, 0.5, 9)
	var ridge := NOISE.ridge(20260625, 384.25, -192.75, 5, 0.01, 2.0, 0.5, 9)
	var warp := NOISE.warp(20260625, 384.25, -192.75, 32.0, 0.005)
	_expect(absf(value - 0.87093022187061) <= EPSILON, "OpenSimplex value fixture drifted")
	_expect(absf(fbm - 0.80078079294632) <= EPSILON, "OpenSimplex fBm fixture drifted")
	_expect(absf(ridge - 0.39843841410736) <= EPSILON, "OpenSimplex ridge fixture drifted")
	_expect(warp.distance_to(Vector2(373.99391833306, -207.09059573171)) <= EPSILON, "OpenSimplex warp fixture drifted")
	_expect(value >= 0.0 and value <= 1.0, "OpenSimplex value exceeded normalized bounds")
	_expect(fbm >= 0.0 and fbm <= 1.0, "OpenSimplex fBm exceeded normalized bounds")
	_expect(ridge >= 0.0 and ridge <= 1.0, "OpenSimplex ridge exceeded normalized bounds")
	_expect(warp == NOISE.warp(20260625, 384.25, -192.75, 32.0, 0.005), "OpenSimplex warp is not repeatable")
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
