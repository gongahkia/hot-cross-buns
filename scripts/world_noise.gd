class_name WorldNoise
extends RefCounted

const SKEW_2D := 0.366025403784439
const UNSKEW_2D := -0.21132486540518713
const RADIUS_2D := 0.5
const NORMALIZER_2D := 0.01001634121365712
const GRADIENTS_2D := [
	Vector2(0.38268343236509, 0.923879532511287) / NORMALIZER_2D,
	Vector2(0.923879532511287, 0.38268343236509) / NORMALIZER_2D,
	Vector2(0.923879532511287, -0.38268343236509) / NORMALIZER_2D,
	Vector2(0.38268343236509, -0.923879532511287) / NORMALIZER_2D,
	Vector2(-0.38268343236509, -0.923879532511287) / NORMALIZER_2D,
	Vector2(-0.923879532511287, -0.38268343236509) / NORMALIZER_2D,
	Vector2(-0.923879532511287, 0.38268343236509) / NORMALIZER_2D,
	Vector2(-0.38268343236509, 0.923879532511287) / NORMALIZER_2D,
	Vector2(0.130526192220052, 0.99144486137381) / NORMALIZER_2D,
	Vector2(0.608761429008721, 0.793353340291235) / NORMALIZER_2D,
	Vector2(0.793353340291235, 0.608761429008721) / NORMALIZER_2D,
	Vector2(0.99144486137381, 0.130526192220051) / NORMALIZER_2D,
	Vector2(0.99144486137381, -0.130526192220051) / NORMALIZER_2D,
	Vector2(0.793353340291235, -0.60876142900872) / NORMALIZER_2D,
	Vector2(0.608761429008721, -0.793353340291235) / NORMALIZER_2D,
	Vector2(0.130526192220052, -0.99144486137381) / NORMALIZER_2D,
	Vector2(-0.130526192220052, -0.99144486137381) / NORMALIZER_2D,
	Vector2(-0.608761429008721, -0.793353340291235) / NORMALIZER_2D,
	Vector2(-0.793353340291235, -0.608761429008721) / NORMALIZER_2D,
	Vector2(-0.99144486137381, -0.130526192220052) / NORMALIZER_2D,
	Vector2(-0.99144486137381, 0.130526192220051) / NORMALIZER_2D,
	Vector2(-0.793353340291235, 0.608761429008721) / NORMALIZER_2D,
	Vector2(-0.608761429008721, 0.793353340291235) / NORMALIZER_2D,
	Vector2(-0.130526192220052, 0.99144486137381) / NORMALIZER_2D,
]

static func value(seed: int, x: float, z: float, salt: int = 0) -> float:
	var skew := (x + z) * SKEW_2D
	var xs := x + skew
	var zs := z + skew
	var xsb := floori(xs)
	var zsb := floori(zs)
	var xi := xs - float(xsb)
	var zi := zs - float(zsb)
	var t := (xi + zi) * UNSKEW_2D
	var dx0 := xi + t
	var dz0 := zi + t
	var sample := _contribution(seed, xsb, zsb, salt, dx0, dz0)
	var a1 := 2.0 * (1.0 + 2.0 * UNSKEW_2D) * (1.0 / UNSKEW_2D + 2.0) * t + (-2.0 * (1.0 + 2.0 * UNSKEW_2D) * (1.0 + 2.0 * UNSKEW_2D) + (RADIUS_2D - dx0 * dx0 - dz0 * dz0))
	if a1 > 0.0:
		var dx1 := dx0 - (1.0 + 2.0 * UNSKEW_2D)
		var dz1 := dz0 - (1.0 + 2.0 * UNSKEW_2D)
		var aa := a1 * a1
		sample += aa * aa * _gradient(seed, xsb + 1, zsb + 1, salt, dx1, dz1)
	if dz0 > dx0:
		sample += _contribution(seed, xsb, zsb + 1, salt, dx0 - UNSKEW_2D, dz0 - (UNSKEW_2D + 1.0))
	else:
		sample += _contribution(seed, xsb + 1, zsb, salt, dx0 - (UNSKEW_2D + 1.0), dz0 - UNSKEW_2D)
	return clampf(sample * 0.5 + 0.5, 0.0, 1.0)

static func fbm(seed: int, x: float, z: float, octaves: int = 5, frequency: float = 0.01, lacunarity: float = 2.0, gain: float = 0.5, salt: int = 0) -> float:
	var current_frequency := frequency
	var amplitude := 1.0
	var total := 0.0
	var norm := 0.0
	for octave in range(maxi(octaves, 0)):
		total += value(seed + (octave + 1) * 101, x * current_frequency, z * current_frequency, salt + (octave + 1) * 17) * amplitude
		norm += amplitude
		current_frequency *= lacunarity
		amplitude *= gain
	return total / norm if norm > 0.0 else 0.0

static func ridge(seed: int, x: float, z: float, octaves: int = 5, frequency: float = 0.01, lacunarity: float = 2.0, gain: float = 0.5, salt: int = 0) -> float:
	return 1.0 - absf(fbm(seed, x, z, octaves, frequency, lacunarity, gain, salt) * 2.0 - 1.0)

static func warp(seed: int, x: float, z: float, amount: float = 32.0, frequency: float = 0.005) -> Vector2:
	var wx := fbm(seed + 7001, x, z, 3, frequency, 2.0, 0.5, 41) * 2.0 - 1.0
	var wz := fbm(seed + 9001, x, z, 3, frequency, 2.0, 0.5, 53) * 2.0 - 1.0
	return Vector2(x + wx * amount, z + wz * amount)

static func _gradient(seed: int, x: int, z: int, salt: int, dx: float, dz: float) -> float:
	var index := int(posmod(WorldRng.thoth_hash(seed, x, z, salt), GRADIENTS_2D.size()))
	return GRADIENTS_2D[index].dot(Vector2(dx, dz))

static func _contribution(seed: int, x: int, z: int, salt: int, dx: float, dz: float) -> float:
	var attenuation := RADIUS_2D - dx * dx - dz * dz
	if attenuation <= 0.0:
		return 0.0
	var squared := attenuation * attenuation
	return squared * squared * _gradient(seed, x, z, salt, dx, dz)
